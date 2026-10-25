import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { veodynRoutePrefixes } from './veodyn-route-prefixes.mjs'

export const DEFAULT_KEY = 'veodynRoutePrefixes'

const USAGE = `check-route-prefix-drift: the ingress must send every Veodyn route to Veodyn, and nothing else.

    node scripts/check-route-prefix-drift.mjs <values> [--key a.b.c] [--app <app dir>]

<values> is a Helm values file, YAML or JSON; JSON needs no dependencies. --key names the list of prefixes
in it (default ${DEFAULT_KEY}). --app is the composed app tree, pack overlays
included (default: this app).`

export async function readValues(path) {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    const { parse } = await import('yaml')
    return parse(text)
  }
}

export function prefixesAt(values, key) {
  const list = key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), values)
  if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) return null
  return list
}

export function routePrefixDrift(expected, declared) {
  const want = new Set(expected)
  const have = new Set(declared)
  return {
    missing: [...want].filter((prefix) => !have.has(prefix)).sort(),
    extra: [...have].filter((prefix) => !want.has(prefix)).sort(),
  }
}

function option(args, name, fallback) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

export async function main(args) {
  const valuesPath = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
  if (!valuesPath) {
    console.error(USAGE)
    return 2
  }
  const key = option(args, '--key', DEFAULT_KEY)
  const appDir = resolve(option(args, '--app', join(dirname(fileURLToPath(import.meta.url)), '..')))
  const declared = prefixesAt(await readValues(valuesPath), key)
  if (declared === null) {
    console.error(`${valuesPath} has no list of strings at ${key}`)
    return 2
  }
  const { missing, extra } = routePrefixDrift(veodynRoutePrefixes(appDir), declared)
  if (missing.length === 0 && extra.length === 0) {
    console.log(`route prefixes match: ${declared.length} in ${valuesPath}`)
    return 0
  }
  for (const prefix of missing) console.error(`missing from ${key}: ${prefix} is a Veodyn route, so the site would answer it`)
  for (const prefix of extra) console.error(`extra in ${key}: ${prefix} is not a Veodyn route, so the site never sees it`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
