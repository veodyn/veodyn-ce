import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BARE_SUBPATH = /((?:from\s*|import\s*\(\s*|^import\s+)['"])((?:@[^/'"]+\/)?[^@./'"][^/'"]*)\/([^'"]+)(['"])/gm
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

function spelledOutSubpath(nodeModules, pkg, sub) {
  const root = join(nodeModules, pkg)
  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) return `${pkg}/${sub}`
  if (JSON.parse(readFileSync(manifestPath, 'utf8')).exports) return `${pkg}/${sub}`
  const target = join(root, sub)
  const subManifest = join(target, 'package.json')
  if (existsSync(subManifest)) {
    const entry = JSON.parse(readFileSync(subManifest, 'utf8'))
    const file = entry.module ?? entry.main
    if (file) return `${pkg}/${join(sub, file).replace(/\\/g, '/')}`
  }
  if (existsSync(`${target}.js`)) return `${pkg}/${sub}.js`
  return `${pkg}/${sub}`
}

export function spellOutSpecifiers(outDir, nodeModules = join(process.cwd(), 'node_modules')) {
  for (const file of files(outDir)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
    const source = readFileSync(file, 'utf8')
    let rewritten = source.replace(RELATIVE, (_, head, specifier, tail) => `${head}${spelledOut(file, specifier)}${tail}`)
    if (file.endsWith('.js')) {
      rewritten = rewritten.replace(BARE_SUBPATH, (_, head, pkg, sub, tail) => `${head}${spelledOutSubpath(nodeModules, pkg, sub)}${tail}`)
    }
    if (rewritten !== source) writeFileSync(file, rewritten)
  }
}
