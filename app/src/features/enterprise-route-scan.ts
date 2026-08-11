// The scanning logic behind enterprise-route-links.test.ts, split out for file
// size only. See that file for what this exists to prove.
//
// The route list is DERIVED from scripts/enterprise-paths.mjs, the one written
// definition of what the enterprise pack owns, never re-listed. A hand-written
// list of enterprise URL prefixes would drift the first time a feature is added
// or a route directory is renamed, and drift is the whole failure mode the
// guard exists for.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ENTERPRISE_PATHS } from '../../scripts/enterprise-paths.mjs'

export const SRC_ROOT = join(process.cwd(), 'src')

/** Every enterprise path, normalised to this platform's separator. */
const ENTERPRISE_TREE_PATHS: string[] = (ENTERPRISE_PATHS as string[]).map((path) => path.split('/').join(sep))

/**
 * A route directory the enterprise pack takes with it, as the URL prefix a
 * browser would ask for.
 *
 * `src/app/kpis` -> `/kpis`, `src/app/admin/shared-links` -> `/admin/shared-links`.
 * Only `src/app/` entries, and only directories: an entry with a file
 * extension is a module, not a route, and the feature packages, components,
 * hooks and lib modules on that list have no URL at all.
 */
export function routePrefixes(paths: string[] = ENTERPRISE_PATHS as string[]): string[] {
  return paths
    .filter((path) => path.startsWith('src/app/') && !/\.[a-z]+$/.test(path))
    .map((path) => path.slice('src/app'.length))
    .sort()
}

export const PREFIXES = routePrefixes()

/** Where a literal sits and what it says. */
export interface RouteLink {
  file: string
  line: number
  literal: string
}

type Scan = { line: number; text: string }

/**
 * Every string and template literal in `source`, with the line it opens on and
 * with comments removed first.
 *
 * Comments ARE stripped here, unlike feature-boundary-scan.ts, and the argument
 * that file makes against stripping does not transfer. There, the thing being
 * looked for is an import specifier, which a descriptor has no legitimate
 * reason to write down at all, live or commented, so reading a commented one as
 * live fails closed on something that is an offence either way. Here the thing
 * being looked for is a URL, and a URL named in a sentence is how a comment
 * explains what a component is for. `heatmap-grid-chrome.ts` says "on a 1080px
 * `/present` slide", in backticks, which is prose and not a link; flagging it
 * would fail closed on correct code and teach the reader to stop writing the
 * explanation.
 *
 * Two known limits, both accepted rather than overlooked. A regular expression
 * containing a literal `//` reads as the start of a line comment, so the rest
 * of that line is skipped; and a backtick inside a template literal's `${}`
 * expression ends the literal early. Both are rare enough that a full
 * tokenizer would be more machinery than the offence is worth, and both fail
 * by reporting LESS rather than by reporting something untrue.
 */
export function literalsIn(source: string): Scan[] {
  const found: Scan[] = []
  let line = 1
  let i = 0

  while (i < source.length) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '\n') {
      line += 1
      i += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1
        i += 1
      }
      i += 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const opened = line
      const closer = char
      let text = ''
      i += 1
      while (i < source.length && source[i] !== closer) {
        if (source[i] === '\\') {
          text += source[i + 1] ?? ''
          i += 2
          continue
        }
        // A newline inside a single- or double-quoted string means the literal
        // was never closed; stop rather than swallowing the rest of the file.
        if (source[i] === '\n') {
          if (closer !== '`') break
          line += 1
        }
        text += source[i]
        i += 1
      }
      i += 1
      found.push({ line: opened, text })
      continue
    }
    i += 1
  }

  return found
}

/**
 * Whether a literal addresses one of the enterprise routes.
 *
 * Boundary-matched, not a bare startsWith, for the reason middleware.ts gives
 * about its own allowlist: `/reports` must not claim `/reportsomething`, and a
 * community route that merely begins with the same characters is not the same
 * route.
 */
function addressesPrefix(text: string, prefix: string): boolean {
  if (!text.startsWith(prefix)) return false
  const rest = text.slice(prefix.length)
  return rest === '' || rest.startsWith('/') || rest.startsWith('?') || rest.startsWith('#')
}

export function routeLinksIn(file: string, source: string, prefixes: string[] = PREFIXES): RouteLink[] {
  return literalsIn(source)
    .filter((scan) => prefixes.some((prefix) => addressesPrefix(scan.text, prefix)))
    .map((scan) => ({ file, line: scan.line, literal: scan.text }))
}

const SOURCE_EXTENSIONS = /\.tsx?$/

export function isSkipped(rel: string): boolean {
  // Inside a directory the enterprise pack owns, or the owned module itself.
  // None of these is present in this tree any more, so nothing is skipped by
  // this branch today; it stays because an overlay build assembles them back in
  // and runs this same suite, and there the skip is what keeps the guard about
  // COMMUNITY modules naming an enterprise route rather than about the feature
  // naming its own.
  if (ENTERPRISE_TREE_PATHS.some((path) => rel === path || rel.startsWith(`${path}${sep}`))) return true
  // Test files and the shared harness. A link written in a suite is not a link
  // a reader can click, and the suites that exercise an enterprise page are
  // owned by the pack along with the page. Scanning them would fill the
  // allowlist with entries that protect nobody.
  if (rel.includes('.test.') || rel.startsWith(`src${sep}test${sep}`)) return true
  if (rel.endsWith('-test-harness.ts') || rel.endsWith('.test-helpers.tsx')) return true
  return false
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) return walk(abs)
    if (!SOURCE_EXTENSIONS.test(name)) return []
    const rel = join('src', relative(SRC_ROOT, abs))
    return isSkipped(rel) ? [] : [rel]
  })
}

/** Every production module under src/ this guard is responsible for. */
export const FILES = walk(SRC_ROOT).sort()

export function code(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8')
}

/** Every enterprise-route literal in the community tree, file order. */
export function scanTree(files: string[] = FILES): RouteLink[] {
  return files.flatMap((file) => routeLinksIn(file, code(file)))
}
