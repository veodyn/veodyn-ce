import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RELATIVE = /((?:from\s*|import\s*\(\s*|^import\s+)['"])(\.{1,2}\/[^'"]+)(['"])/gm

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

function spelledOut(file, rawSpecifier) {
  if (rawSpecifier.endsWith('.js') || rawSpecifier.endsWith('.css')) return rawSpecifier
  const specifier = rawSpecifier.replace(/\.tsx?$/, '')
  const declaration = file.endsWith('.d.ts')
  const base = join(dirname(file), specifier)
  if (existsSync(`${base}.js`) || (declaration && existsSync(`${base}.d.ts`))) return `${specifier}.js`
  if (existsSync(join(base, 'index.js')) || (declaration && existsSync(join(base, 'index.d.ts')))) {
    return `${specifier}/index.js`
  }
  throw new Error(`${file}: cannot spell out ${specifier}`)
}

export function spellOutSpecifiers(outDir) {
  for (const file of files(outDir)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
    const source = readFileSync(file, 'utf8')
    const rewritten = source.replace(RELATIVE, (_, head, specifier, tail) => `${head}${spelledOut(file, specifier)}${tail}`)
    if (rewritten !== source) writeFileSync(file, rewritten)
  }
}
