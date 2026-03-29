import { z, type PawDefinition } from '@openvole/paw-sdk'

let dbClient: DatabaseClient | null = null

interface DatabaseClient {
	type: string
	query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
	execute(sql: string, params?: unknown[]): Promise<{ changes: number }>
	schema(): Promise<Array<{ table: string; columns: Array<{ name: string; type: string; nullable: boolean }> }>>
	close(): void
}

/** SQLite client using better-sqlite3 */
async function createSQLiteClient(dbPath: string): Promise<DatabaseClient> {
	const { default: Database } = await import('better-sqlite3')
	const db = new Database(dbPath)
	db.pragma('journal_mode = WAL')

	return {
		type: 'sqlite',
		async query(sql, params) {
			const stmt = db.prepare(sql)
			const rows = params ? stmt.all(...params) : stmt.all()
			return { rows, rowCount: rows.length }
		},
		async execute(sql, params) {
			const stmt = db.prepare(sql)
			const result = params ? stmt.run(...params) : stmt.run()
			return { changes: result.changes }
		},
		async schema() {
			const tables = db.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
			).all() as Array<{ name: string }>

			return tables.map((t) => {
				const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{
					name: string
					type: string
					notnull: number
				}>
				return {
					table: t.name,
					columns: cols.map((c) => ({
						name: c.name,
						type: c.type,
						nullable: c.notnull === 0,
					})),
				}
			})
		},
		close() {
			db.close()
		},
	}
}

/** PostgreSQL/MySQL client using fetch-based wire protocol isn't practical.
 *  Use URL-based connection strings with native drivers if available,
 *  otherwise fall back to shell commands. */
async function createNetworkClient(url: string, type: string): Promise<DatabaseClient> {
	// For PostgreSQL and MySQL, use shell-based execution
	// This avoids requiring pg/mysql2 native dependencies
	const { execSync } = await import('node:child_process')

	const shellQuery = (sql: string): string => {
		if (type === 'postgresql' || type === 'postgres') {
			return execSync(`psql "${url}" -t -A -F '	' -c ${JSON.stringify(sql)}`, {
				encoding: 'utf-8',
				timeout: 30000,
			}).trim()
		}
		if (type === 'mysql') {
			// Parse URL for mysql CLI
			const parsed = new URL(url)
			const args = [
				'-h', parsed.hostname,
				'-P', parsed.port || '3306',
				'-u', parsed.username,
				`-p${parsed.password}`,
				parsed.pathname.slice(1), // database name
				'-N', '-B',
				'-e', sql,
			]
			return execSync(`mysql ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
				encoding: 'utf-8',
				timeout: 30000,
			}).trim()
		}
		throw new Error(`Unsupported database type: ${type}`)
	}

	return {
		type,
		async query(sql) {
			const output = shellQuery(sql)
			if (!output) return { rows: [], rowCount: 0 }
			const lines = output.split('\n')
			const rows = lines.map((line) => {
				const values = line.split('\t')
				const row: Record<string, string> = {}
				values.forEach((v, i) => { row[`col${i}`] = v })
				return row
			})
			return { rows, rowCount: rows.length }
		},
		async execute(sql) {
			shellQuery(sql)
			return { changes: -1 } // Shell doesn't report changes easily
		},
		async schema() {
			let sql: string
			if (type === 'postgresql' || type === 'postgres') {
				sql = `SELECT table_name, column_name, data_type, is_nullable
					FROM information_schema.columns
					WHERE table_schema = 'public'
					ORDER BY table_name, ordinal_position`
			} else {
				sql = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
					FROM information_schema.COLUMNS
					WHERE TABLE_SCHEMA = DATABASE()
					ORDER BY TABLE_NAME, ORDINAL_POSITION`
			}
			const output = shellQuery(sql)
			if (!output) return []

			const tableMap = new Map<string, Array<{ name: string; type: string; nullable: boolean }>>()
			for (const line of output.split('\n')) {
				const [table, col, dtype, nullable] = line.split('\t')
				if (!table) continue
				if (!tableMap.has(table)) tableMap.set(table, [])
				tableMap.get(table)!.push({
					name: col,
					type: dtype,
					nullable: nullable === 'YES',
				})
			}

			return Array.from(tableMap.entries()).map(([table, columns]) => ({ table, columns }))
		},
		close() {
			// Shell-based — nothing to close
		},
	}
}

async function getClient(): Promise<DatabaseClient> {
	if (dbClient) return dbClient

	const url = process.env.DATABASE_URL
	if (!url) throw new Error('DATABASE_URL not set')

	const type = process.env.DATABASE_TYPE?.toLowerCase()

	if (url.endsWith('.db') || url.endsWith('.sqlite') || url.endsWith('.sqlite3') || type === 'sqlite') {
		dbClient = await createSQLiteClient(url)
	} else if (url.startsWith('postgres') || type === 'postgresql' || type === 'postgres') {
		dbClient = await createNetworkClient(url, 'postgresql')
	} else if (url.startsWith('mysql') || type === 'mysql') {
		dbClient = await createNetworkClient(url, 'mysql')
	} else {
		// Default to SQLite
		dbClient = await createSQLiteClient(url)
	}

	return dbClient
}

const readOnly = process.env.VOLE_DB_READONLY === 'true'

export const paw: PawDefinition = {
	name: '@openvole/paw-database',
	version: '1.0.0',
	description: 'Query PostgreSQL, MySQL, and SQLite databases',

	tools: [
		{
			name: 'db_query',
			description: 'Execute a read-only SQL query and return results as rows. Use for SELECT statements.',
			parameters: z.object({
				sql: z.string().describe('SQL query to execute (SELECT only)'),
				limit: z.number().optional().describe('Max rows to return (default: 100)'),
			}),
			async execute(params) {
				const { sql, limit } = params as { sql: string; limit?: number }
				const upper = sql.trim().toUpperCase()
				if (!upper.startsWith('SELECT') && !upper.startsWith('WITH') && !upper.startsWith('EXPLAIN')) {
					return { ok: false, error: 'db_query only accepts SELECT/WITH/EXPLAIN statements. Use db_execute for writes.' }
				}
				const client = await getClient()
				const limitedSql = limit ? `${sql} LIMIT ${limit}` : `${sql} LIMIT 100`
				const result = await client.query(limitedSql)
				return { ok: true, rows: result.rows, rowCount: result.rowCount }
			},
		},
		{
			name: 'db_schema',
			description: 'List all tables and their columns (name, type, nullable). Use this before writing queries to understand the schema.',
			parameters: z.object({}),
			async execute() {
				const client = await getClient()
				const schema = await client.schema()
				return { ok: true, tables: schema }
			},
		},
		{
			name: 'db_execute',
			description: 'Execute a write SQL statement (INSERT, UPDATE, DELETE, CREATE, ALTER). Blocked if VOLE_DB_READONLY=true.',
			parameters: z.object({
				sql: z.string().describe('SQL statement to execute'),
			}),
			async execute(params) {
				if (readOnly) {
					return { ok: false, error: 'Database is in read-only mode (VOLE_DB_READONLY=true)' }
				}
				const { sql } = params as { sql: string }
				const client = await getClient()
				const result = await client.execute(sql)
				return { ok: true, changes: result.changes }
			},
		},
	],

	async onLoad() {
		const url = process.env.DATABASE_URL
		if (!url) {
			console.log('[paw-database] DATABASE_URL not set — tools will error on use')
			return
		}
		try {
			const client = await getClient()
			console.log(`[paw-database] loaded — type: ${client.type}, readonly: ${readOnly}`)
		} catch (err) {
			console.log(`[paw-database] failed to connect: ${err instanceof Error ? err.message : String(err)}`)
		}
	},

	async onUnload() {
		if (dbClient) {
			dbClient.close()
			dbClient = null
		}
	},
}
