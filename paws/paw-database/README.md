# @openvole/paw-database

**Query PostgreSQL, MySQL, and SQLite databases.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-database)](https://www.npmjs.com/package/@openvole/paw-database)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-database
```

## Config

```json
{
  "name": "@openvole/paw-database",
  "allow": {
    "network": ["*"],
    "filesystem": ["./"],
    "env": ["DATABASE_URL", "DATABASE_TYPE", "VOLE_DB_READONLY"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Connection string. SQLite: `/path/to/db.sqlite`, PostgreSQL: `postgres://user:pass@host/db`, MySQL: `mysql://user:pass@host/db` |
| `DATABASE_TYPE` | Force type: `sqlite`, `postgresql`, `mysql` (auto-detected from URL if not set) |
| `VOLE_DB_READONLY` | Set to `true` to block write operations (INSERT/UPDATE/DELETE) |

## Tools

| Tool | Description |
|------|-------------|
| `db_query` | Execute a read-only SQL query (SELECT/WITH/EXPLAIN). Auto-limited to 100 rows |
| `db_schema` | List all tables and their columns (name, type, nullable) |
| `db_execute` | Execute a write statement (INSERT/UPDATE/DELETE/CREATE). Blocked if read-only mode |

## Database Support

- **SQLite** — via better-sqlite3, in-process, no external service needed
- **PostgreSQL** — via `psql` CLI (must be installed)
- **MySQL** — via `mysql` CLI (must be installed)

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
