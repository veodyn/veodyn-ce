#!/usr/bin/env node
/**
 * Refuse an enterprise path that has come back into the community tree.
 *
 * The claim is narrow: no path the enterprise pack owns exists in this tree. It
 * is what regresses quietly, because an enterprise module added back here would
 * type-check, lint and test perfectly well, and only breaks when somebody ships
 * the community edition.
 *
 * It does not check that the community build works (lint, tsc and the suite are
 * that), and it cannot check that the list is complete: the list is
 * hand-maintained, and four audits each found paths an earlier glob spelled
 * past. A hardcoded `/kpis` href is a separate guard,
 * src/features/enterprise-route-links.test.ts, which derives its prefixes from
 * this same list.
 *
 * Usage: node scripts/check-ce-tree.mjs
 * Exit 0 when the tree is clean, 1 when an enterprise path is present.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENTERPRISE_PATHS } from './enterprise-paths.mjs'

// Both exist for scripts/check-ce-tree.test.ts, so the guard can be proven to
// catch a planted path. Neither is meant to be set by a developer or by CI.
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
