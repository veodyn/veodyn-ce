import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILD_OUTPUT_PREFIXES = ['/_next', '/packages']

const NOT_A_SEGMENT = /^[(_@]/
const DYNAMIC_SEGMENT = /^\[/

function entries(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []
}

export function appRoutePrefixes(appDir) {
  const prefixes = []
  for (const entry of entries(join(appDir, 'src/app'))) {
    if (!entry.isDirectory() || NOT_A_SEGMENT.test(entry.name)) continue
    if (DYNAMIC_SEGMENT.test(entry.name)) {
      throw new Error(`src/app/${entry.name} is a top-level dynamic route, which no prefix list can enumerate`)
    }
    prefixes.push(`/${entry.name}`)
  }
  return prefixes
}

export function publicPrefixes(appDir) {
  return entries(join(appDir, 'public')).map((entry) => `/${entry.name}`)
}

export function veodynRoutePrefixes(appDir) {
  return [...new Set([...appRoutePrefixes(appDir), ...publicPrefixes(appDir), ...BUILD_OUTPUT_PREFIXES])].sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appDir = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  process.stdout.write(`${JSON.stringify(veodynRoutePrefixes(appDir), null, 2)}\n`)
}
