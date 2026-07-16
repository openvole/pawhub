#!/usr/bin/env node
/**
 * Generate INDEX.json from the paw manifests — the machine-readable registry for PawHub.
 *
 * Mirrors the VoleHub contract (openvole/volehub/INDEX.json): a single file at the repo root
 * that both the landing page and any registry client can read, so nothing hand-maintains a
 * second copy of what vole-paw.json already states.
 *
 *   node scripts/build-index.mjs          # write INDEX.json
 *   node scripts/build-index.mjs --check  # fail if it is stale (CI)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAWS = path.join(ROOT, 'paws')
const OUT = path.join(ROOT, 'INDEX.json')

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

const entry = async (dir) => {
	const manifest = await readJson(path.join(PAWS, dir, 'vole-paw.json'))
	// package.json is the source of truth for version + publication; vole-paw.json for capability.
	let pkg = {}
	try {
		pkg = await readJson(path.join(PAWS, dir, 'package.json'))
	} catch {
		/* a paw without a package.json is source-only */
	}
	const perms = manifest.permissions ?? {}
	// `private: true` marks a paw as not-for-publication; those are excluded from the registry
	// entirely (see below), so anything reaching here is installable from npm.
	const published = pkg.private !== true

	return {
		name: manifest.name,
		slug: dir,
		version: pkg.version ?? manifest.version ?? '0.0.0',
		description: manifest.description ?? '',
		category: manifest.category ?? 'tool',
		brain: manifest.brain === true,
		transport: manifest.transport ?? 'ipc',
		published,
		// Brains implement think() rather than exposing tools, so an empty list is expected.
		tools: (manifest.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? '' })),
		permissions: {
			network: perms.network ?? [],
			filesystem: perms.filesystem ?? [],
			env: perms.env ?? [],
			listen: perms.listen ?? [],
		},
		repository: `https://github.com/openvole/pawhub/tree/main/paws/${dir}`,
		npm: published ? `https://www.npmjs.com/package/${manifest.name}` : null,
	}
}

const dirs = (await readdir(PAWS, { withFileTypes: true }))
	.filter((d) => d.isDirectory() && d.name.startsWith('paw-'))
	.map((d) => d.name)
	.sort()

const all = await Promise.all(dirs.map(entry))
// The registry lists what the public can actually get. A `private: true` paw is not on npm and
// may not even be committed (it is someone's work in progress), so listing it would advertise a
// dead install command and a source link that 404s.
const paws = all.filter((p) => p.published)
const skipped = all.filter((p) => !p.published).map((p) => p.slug)

const index = {
	updatedAt: new Date().toISOString(),
	counts: {
		paws: paws.length,
		tools: paws.reduce((n, p) => n + p.tools.length, 0),
	},
	paws,
}

const serialise = (i) => `${JSON.stringify(i, null, 2)}\n`

if (process.argv.includes('--check')) {
	// updatedAt always differs, so compare everything else.
	const stable = (i) => JSON.stringify({ ...i, updatedAt: null })
	let current = null
	try {
		current = await readJson(OUT)
	} catch {
		console.error('INDEX.json missing — run: node scripts/build-index.mjs')
		process.exit(1)
	}
	if (stable(current) !== stable(index)) {
		console.error('INDEX.json is stale — run: node scripts/build-index.mjs')
		process.exit(1)
	}
	console.log(`INDEX.json up to date (${index.counts.paws} paws, ${index.counts.tools} tools)`)
} else {
	await writeFile(OUT, serialise(index))
	console.log(`INDEX.json → ${index.counts.paws} paws, ${index.counts.tools} tools`)
	if (skipped.length) console.log(`  skipped (private, not published): ${skipped.join(', ')}`)
}
