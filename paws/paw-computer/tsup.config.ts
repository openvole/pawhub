import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node20',
	splitting: false,
	external: ['@nut-tree-fork/nut-js'],
})
