// The scanning and resolution logic behind feature-boundary.test.ts, split
// out for file size only. See that file for what this exists to prove.
//
// The import check is an ALLOWLIST, not a denylist, same shape as
// src/plugins/plugin-boundary.test.ts. A denylist of today's feature import
// paths is strictly weaker: a future feature's descriptor could import, say,
// `@/components/forecast` and pass, because nothing in a fixed pattern list
// names a package that does not exist yet.
//
// A relative specifier is not merely allowed by its `./` or `../` prefix: it
// is RESOLVED against the file that imports it, and the result has to land
// inside that descriptor's own package directory, with one named exception
// (`../types`, the shared FeatureDescriptor types module every package
// legitimately reaches out of its own directory for). Checking the prefix
// alone would let `../../../hooks/use-kpis` through: it starts with `../`,
// so a prefix check calls it a relative path and stops looking, even though
// climbing three directories up from src/features/<pkg>/ walks straight out
// of src/features entirely. Resolving the path is what actually closes that.
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
 * Every source file in every package, as a path relative to src/features, so
 * a failure names the package as well as the file. Recursive for the same
 * reason the plugin guard is: nothing stops a package from having
 * subdirectories, and a guard that assumed flat would skip the first nested
 * file silently.
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

// Everything a descriptor package file may import outright, with no
// resolution needed. A descriptor legitimately imports `lucide-react` for
// its icons; every relative specifier is checked by resolving it, below.
export const ALLOWED = ['lucide-react']
export const ALLOWED_PREFIXES = ['./', '../']

// Comment-stripping is not done here, unlike the plugin guard this file
// mirrors. That guard's own stripComments() does not understand string
// literals, so a string containing "/*" would make it swallow the rest of
// the file, and a comment-aware but string-unaware stripper is exactly that
// same hole moved one line down. Rather than write a full tokenizer for a
// two-import allowlist, the guard reads the raw source: an import written
// inside a comment fails it exactly as if it were live code. That is failing
// closed, and it is the correct side to fail on here, because a descriptor
// file has no legitimate reason to write out a disallowed import specifier
// at all, live or commented.
export function code(file: string): string {
  return readFileSync(join(FEATURES_ROOT, file), 'utf8')
}

// The lookbehind is load-bearing, same reason as the plugin guard: without it
// the `from` inside an ordinary identifier reads as the keyword and the
// capture runs from the following bracket to the next quote in the file.
//
// The optional paren group is what tells a static import from a dynamic one.
// `require(...)` counts as STATIC even though it is a call, because it
// resolves and executes synchronously at module scope, which is the thing this
// guard exists to prevent. Only `import(...)` is deferred.
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
 * This exemption is a deliberate reversal of what the comment on
 * `templateLiteralImportsIn` below used to assert, that "a descriptor has no
 * legitimate reason to import dynamically at all". That was true while every
 * feature lived in this repository. The CE/EE split gave it one: a descriptor
 * is how the community tree reaches an enterprise feature's search source,
 * slot component and proposal renderers, and a static import of any of them
 * would be exactly the offence this guard is for.
 *
 * The invariant is unchanged and is worth stating precisely, because it is
 * narrower than "descriptors import nothing". What must never happen is a
 * descriptor pulling feature implementation into the module graph of the
 * server root layout, which reaches this registry through
 * `src/lib/theme-preference.ts`. A deferred import does not: the specifier is
 * a string until something calls the loader, and nothing on the pre-paint path
 * calls one. A static import of the same specifier still fails, and there is a
 * test asserting that the two are treated differently.
 *
 * Template literals stay closed, for the reason given below: their target is
 * not statically knowable, so there is nothing to check.
 */
export function deferredImportsIn(source: string): string[] {
  return specifiers(source)
    .filter((entry) => entry.deferred)
    .map((entry) => entry.specifier)
}

/**
 * Every `import(...)` written with a template literal rather than a plain
 * quoted string. importsIn() never sees these: it only matches `'...'` and
 * `"..."`. A template literal has its own grammar (backticks, and it can
 * embed arbitrary expressions such as `` import(`../../../hooks/${name}`) ``
 * whose target cannot be known without evaluating the program), so rather
 * than partially parse it, every one found here is reported as an offender
 * outright, and closes a case the string-literal regex cannot see rather than
 * pretending to resolve something that is not statically resolvable.
 *
 * `import('...')` with a plain string literal IS now legitimate; see
 * `deferredImportsIn` above for what changed and why the invariant survives.
 * A template literal is still refused, because there is no specifier to judge.
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
