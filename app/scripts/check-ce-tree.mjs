#!/usr/bin/env node
/**
 * Refuse an enterprise path that has come back into the community tree.
 *
 * WHAT THIS REPLACED, AND WHY IT COULD NOT SURVIVE
 *
 * scripts/check-ce-build.mjs measured the gap between this tree and a build
 * with no enterprise features: it moved all 129 paths in the list aside,
 * regenerated an empty feature registry, type-checked, and compared the
 * resulting error set to a committed baseline. That number went 78 -> 0 over
 * seven tasks, and then EE-3 Task 6c carried the move out for real.
 *
 * At that point the old check could not run at all, let alone report a
 * meaningful zero. Its first step asserts every target exists and throws when
 * one does not ("a missing directory here means the move list is stale against
 * the tree"), which after the move is all 129 of them. Even with that
 * assertion removed it would have degenerated into a plain `tsc --noEmit`,
 * which `pnpm exec tsc --noEmit` already runs one line earlier in the same CI
 * job. A check that passes while measuring nothing is this project's
 * most-repeated defect and the alternative to it was not "leave it alone".
 *
 * So the list outlived the ratchet, and this is what now reads it. The claim is
 * narrow and it is worth stating exactly: **no path the enterprise pack owns
 * exists in this tree.** That is the one thing about the CE/EE line a community
 * checkout can check on its own, and it is the thing that regresses quietly,
 * because an enterprise module added back here would type-check, lint and test
 * perfectly well. It only becomes wrong at the moment someone tries to ship the
 * community edition.
 *
 * WHAT IT DOES NOT CHECK, so nobody reads more into a green run than is there:
 *
 *   1. That the community build WORKS. Nothing is built, rendered or run here.
 *      `pnpm lint`, `pnpm exec tsc --noEmit` and `pnpm test` are that, and they
 *      are now measuring the real community tree rather than a rehearsal of it,
 *      which is the whole benefit of having done the move.
 *   2. That the list is COMPLETE. It is hand-maintained, and four audits each
 *      found paths an earlier glob had spelled past. An enterprise module
 *      written here tomorrow under a name nobody adds to the list is invisible
 *      to this and to everything else in this repository.
 *   3. Anything a path cannot express. A community module that hardcodes
 *      `/kpis` in a href is a separate guard,
 *      src/features/enterprise-route-links.test.ts, which derives its prefixes
 *      from this same list.
 *
 * Usage:
 *   node scripts/check-ce-tree.mjs
 *
 * Exit 0 when the tree is clean, 1 when an enterprise path is present.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENTERPRISE_PATHS } from './enterprise-paths.mjs'

// Both exist for scripts/check-ce-tree.test.ts, so the guard can be proven to
// catch a planted path against a small fixture rather than only ever being run
// against a tree where it has nothing to say. Neither is meant to be set by a
// developer or by CI: unset, this is exactly the check described above.
const APP_ROOT = process.env.CE_TREE_APP_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')
const PATHS = process.env.CE_TREE_PATHS_JSON ? JSON.parse(process.env.CE_TREE_PATHS_JSON) : ENTERPRISE_PATHS

function main() {
  if (PATHS.length === 0) {
    // A list that has been emptied would make every run green while checking
    // nothing, which is the failure mode this whole file is a reaction to.
    console.error('check-ce-tree: the enterprise path list is empty, so this run would check nothing. Refusing.')
    return 2
  }

  const present = PATHS.filter((path) => existsSync(join(APP_ROOT, path)))

  if (present.length === 0) {
    console.log(`check-ce-tree: clean. None of the ${PATHS.length} enterprise paths is present in this tree.`)
    return 0
  }

  console.error(
    `check-ce-tree: ${present.length} enterprise path(s) are present in the community tree and must not be:`
  )
  for (const path of present) console.error(`  ${path}`)
  console.error(
    'check-ce-tree: these belong to the enterprise pack. Either the file was added here by mistake, or it is ' +
      'genuinely community code and its entry in scripts/enterprise-paths.mjs is wrong, in which case remove the ' +
      'entry and say in the commit message which consumers decided it.'
  )
  return 1
}

process.exitCode = main()
