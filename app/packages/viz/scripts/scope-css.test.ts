import { describe, expect, it } from 'vitest'
import { scopeCss } from './scope-css.mjs'

const squash = (css: string) => css.replace(/\s+/g, ' ').replace(/\{\s*/g, '{ ').replace(/\s*\}/g, ' }').trim()

describe('scopeCss', () => {
  it('scopes an ordinary rule under the root class', async () => {
    expect(squash(await scopeCss('.flex { display: flex }'))).toBe('@layer veodyn { .veodyn .flex { display: flex } }')
  })

  it('scopes every selector in a list', async () => {
    expect(squash(await scopeCss('h1, .title { margin: 0 }'))).toContain('.veodyn h1, .veodyn .title')
  })

  it('turns document-level variable hosts into the root itself', async () => {
    expect(squash(await scopeCss(':root, :host { --chart-1: red }'))).toContain('.veodyn { --chart-1: red }')
  })

  it('drops rules for html and body, which belong to the host', async () => {
    const out = squash(await scopeCss('html, body { line-height: 1.5 } .x { color: red }'))
    expect(out).not.toContain('line-height')
    expect(out).toContain('.veodyn .x')
  })

  it('keeps the root-scoped half of a list that mixes html with a scopable selector', async () => {
    expect(squash(await scopeCss('html, :host { tab-size: 4 }'))).toContain('.veodyn { tab-size: 4 }')
  })

  it('leaves keyframe steps alone', async () => {
    const out = squash(await scopeCss('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }'))
    expect(out).toContain('from { opacity: 0 }')
    expect(out).not.toContain('.veodyn from')
  })

  it('leaves font faces and property registrations alone', async () => {
    const out = squash(await scopeCss('@font-face { font-family: X } @property --tw-x { syntax: "*"; inherits: false }'))
    expect(out).toContain('@font-face { font-family: X }')
    expect(out).toContain('@property --tw-x')
  })

  it('scopes rules nested in media queries and layers', async () => {
    const out = squash(await scopeCss('@media (min-width: 40rem) { .lg\\:flex { display: flex } } @layer utilities { .p-4 { padding: 1rem } }'))
    expect(out).toContain('.veodyn .lg\\:flex')
    expect(out).toContain('.veodyn .p-4')
  })

  it('leaves a selector that already starts at the root alone', async () => {
    expect(squash(await scopeCss('.veodyn[data-theme="dark"] { --card: black }'))).toContain('.veodyn[data-theme="dark"] {')
  })

  it('scopes a bare universal selector and pseudo elements', async () => {
    expect(squash(await scopeCss('*, ::before { box-sizing: border-box }'))).toContain('.veodyn *, .veodyn ::before')
  })

  it('leaves the root font to the host rather than a fallback stack', async () => {
    const out = squash(await scopeCss('html, :host { font-family: var(--default-font-family, ui-sans-serif); line-height: 1.5 }'))
    expect(out).toContain('.veodyn { line-height: 1.5 }')
    expect(out).not.toContain('font-family')
  })

  it('drops a root rule left empty once its font is removed', async () => {
    expect(squash(await scopeCss(':host { font-family: serif }'))).not.toContain('.veodyn')
  })

  it('keeps a font family set on anything below the root', async () => {
    expect(squash(await scopeCss('code { font-family: monospace }'))).toContain('.veodyn code { font-family: monospace }')
  })

  it('removes every !important flag', async () => {
    expect(await scopeCss('.x { top: 50% !important }')).not.toContain('!important')
  })
})
