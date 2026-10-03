import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { postcss } from './postcss.mjs'
import { scopePlugin } from './scope-css.mjs'

const tailwind = createRequire(import.meta.url)('@tailwindcss/postcss')

const DARK_TOKENS = '.veodyn[data-theme="dark"], [data-theme="dark"]'

function packageTokens(appCss) {
  const root = postcss.parse(appCss)
  root.walkRules((rule) => {
    if (rule.selector === '.dark') rule.selector = DARK_TOKENS
  })
  root.walkDecls(/^--font-(sans|display)-family$/, (decl) => decl.remove())
  return root.toString()
}

function themeBlock(globalsCss) {
  let block = ''
  postcss.parse(globalsCss).walkAtRules('theme', (rule) => {
    if (rule.params === 'inline') block = rule.toString()
  })
  if (!block) throw new Error('globals.css has no @theme inline block')
  return block
}

export async function buildCss({ appRoot, outFile }) {
  const pkgSrc = join(appRoot, 'packages/viz/src')
  const tokens = packageTokens(readFileSync(join(appRoot, 'src/app/tokens.css'), 'utf8'))
  const theme = themeBlock(readFileSync(join(appRoot, 'src/app/globals.css'), 'utf8'))
  const input = [
    '@import "tailwindcss" source(none);',
    '@import "tw-animate-css";',
    '@import "shadcn/tailwind.css";',
    '@source "./";',
    '@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));',
    tokens,
    theme,
    '@layer base { * { @apply border-border outline-ring/50; } }',
  ].join('\n')
  const result = await postcss([tailwind({ base: pkgSrc }), scopePlugin()]).process(input, {
    from: join(pkgSrc, 'styles.css'),
  })
  writeFileSync(outFile, result.css)
}
