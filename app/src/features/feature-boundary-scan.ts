// The scanning and resolution logic behind feature-boundary.test.ts, split
// out for file size only. See that file for what this exists to prove.
//
// The import check is an ALLOWLIST, not a denylist, same shape as
// src/plugins/plugin-boundary.test.ts: a fixed pattern list cannot name a
// package that does not exist yet.
//
// A relative specifier is RESOLVED against the file that imports it and must
// land inside that descriptor's own package directory, with one named exception
// (`../types`, the shared FeatureDescriptor types module). Checking the `../`
// prefix alone would let `../../../hooks/use-kpis` through, which climbs out of
// src/features entirely.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const FEATURES_ROOT = join(process.cwd(), 'src/features')
export const TYPES_MODULE = resolve(FEATURES_ROOT, 'types')

/** Every feature package: one directory under src/features. */
export const PACKAGES = readdirSync(FEATURES_ROOT)
  .filter((name) => statSync(join(FEATURES_ROOT, name)).isDirectory())
  .sort()

// Every source extension the build can actually consume, not just .ts:
// tsconfig.json enables allowJs, so a stray .js helper would still ship.
const SOURCE_EXTENSIONS = /\.(?:tsx|ts|jsx|js|mjs|cjs|mts|cts)$/

/**
 * Every source file in every package, as a path relative to src/features, so a
 * failure names the package as well as the file. Recursive because nothing
 * stops a package from having subdirectories.
 */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) return sourceFilesUnder(abs)
    if (!SOURCE_EXTENSIONS.test(name) || name.includes('.test.')) return []
    return [relative(FEATURES_ROOT, abs)]
  })
}

export const FILES = PACKAGES.flatMap((pkg) => sourceFilesUnder(join(FEATURES_ROOT, pkg))).sort()

// Everything a descriptor package file may import outright, with no resolution
// needed. Every relative specifier is checked by resolving it, below.
export const ALLOWED = ['lucide-react']
export const ALLOWED_PREFIXES = ['./', '../']

// Comments are NOT stripped, unlike the plugin guard this file mirrors: an
// import specifier written inside a comment fails the guard exactly as live
// code would. That is failing closed, and it is the right side here, because a
// descriptor has no legitimate reason to write out a disallowed specifier at
// all.
export function code(file: string): string {
  return readFileSync(join(FEATURES_ROOT, file), 'utf8')
}

// The lookbehind is load-bearing: without it the `from` inside an ordinary
// identifier reads as the keyword and the capture runs to the next quote in the
// file. The optional paren group tells a static import from a dynamic one.
// `require(...)` counts as STATIC even though it is a call, because it resolves
// and executes synchronously at module scope. Only `import(...)` is deferred.
const SPECIFIER = /(?<![\w$.])(from|import|require)\s*(\()?\s*['"]([^'"]+)['"]/g

function specifiers(source: string): { keyword: string; deferred: boolean; specifier: string }[] {
  return [...source.matchAll(SPECIFIER)].map((match) => ({
    keyword: match[1],
    deferred: match[1] === 'import' && match[2] !== undefined,
    specifier: match[3],
  }))
}

/** Every specifier a descriptor pulls in at module scope. */
export function importsIn(source: string): string[] {
  return specifiers(source)
    .filter((entry) => !entry.deferred)
    .map((entry) => entry.specifier)
}

/**
 * Every specifier reached through `import('...')`, which is NOT an offence.
 *
 * The invariant is narrower than "descriptors import nothing": what must never
 * happen is a descriptor pulling feature implementation into the module graph
 * of the server root layout, which reaches this registry through
 * src/lib/theme-preference.ts. A deferred specifier is a string until something
 * calls the loader, and nothing on the pre-paint path calls one. The CE/EE
 * split needs that seam: a descriptor is how the community tree reaches an
 * enterprise feature's search source, slot component and proposal renderers.
 * A static import of the same specifier still fails, and a test asserts the two
 * are treated differently.
 */
export function deferredImportsIn(source: string): string[] {
  return specifiers(source)
    .filter((entry) => entry.deferred)
    .map((entry) => entry.specifier)
}

/**
 * Every `import(...)` written with a template literal rather than a plain
 * quoted string. importsIn() never sees these, and a template literal's target
 * cannot be known without evaluating the program (`` import(`../../${name}`) ``),
 * so every one found here is reported as an offender rather than partly parsed.
 */
export function templateLiteralImportsIn(source: string): string[] {
  return [...source.matchAll(/(?<![\w$.])import\s*\(\s*`([^`]*)`/g)].map((match) => `import(\`${match[1]}\`)`)
}

/** Resolve a relative specifier written inside `file` (itself a path relative to FEATURES_ROOT, e.g. "reports/index.ts") to an absolute path. */
function resolveRelative(file: string, specifier: string): string {
  return resolve(dirname(join(FEATURES_ROOT, file)), specifier)
}

/**
 * Whether a specifier written inside `file` is outside what a descriptor may
 * import: not on the flat allowlist, not `../types`, and if it is a relative
 * path, resolving outside that file's own package directory.
 */
function isOffender(file: string, specifier: string): boolean {
  if (ALLOWED.includes(specifier)) return false
  if (!ALLOWED_PREFIXES.some((prefix) => specifier.startsWith(prefix))) return true
  const resolved = resolveRelative(file, specifier)
  if (resolved === TYPES_MODULE) return false
  const pkgDir = resolve(FEATURES_ROOT, file.split(sep)[0])
  const rel = relative(pkgDir, resolved)
  return rel === '' ? false : rel.startsWith('..') || isAbsolute(rel)
}

export function offendersIn(file: string, source: string): string[] {
  return [
    ...importsIn(source).filter((specifier) => isOffender(file, specifier)),
    ...templateLiteralImportsIn(source),
  ]
}
