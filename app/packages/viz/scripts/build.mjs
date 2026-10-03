import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCss } from './build-css.mjs'
import { spellOutSpecifiers } from './specifiers.mjs'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = resolve(pkgRoot, '../..')
const outDir = resolve(process.argv[2] ?? join(pkgRoot, 'dist'))
const CLIENT_ENTRIES = ['index.js', 'ui.js']

rmSync(outDir, { recursive: true, force: true })
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-p', join(pkgRoot, 'tsconfig.build.json'), '--outDir', outDir], { stdio: 'inherit' })

spellOutSpecifiers(outDir)

for (const entry of CLIENT_ENTRIES) {
  const file = join(outDir, entry)
  writeFileSync(file, `'use client';\n${readFileSync(file, 'utf8')}`)
}

await buildCss({ appRoot, outFile: join(outDir, 'styles.css') })
