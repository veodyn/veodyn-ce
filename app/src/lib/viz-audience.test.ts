// Who a visualization type is offered to.
//
// Its own file because it registers plugins into the module-scope registry,
// and vitest isolates a registry per test file. Folding these into
// viz-choices.test.ts would leave an internal type registered underneath the
// assertions there that compare visibleVisualizations() against the whole
// registry, and those would start failing for a reason unrelated to what they
// test.
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_API_VERSION,
  getVisualization,
  registerVisualization,
  type VisualizationPlugin,
} from '@/lib/visualizations'
import { effectiveAudience, visibleVisualizations } from '@/lib/viz-choices'
import { isRenderableComponent } from '@/test/component-shape'

function fakePlugin(type: string, over: Partial<VisualizationPlugin> = {}): VisualizationPlugin {
  return {
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: type,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
    ...over,
  }
}

const BACKDROP = fakePlugin('TEST_BACKDROP', { displayName: 'Backdrop', audience: 'internal' })
const BOARD = fakePlugin('TEST_BOARD', { displayName: 'Board' })

registerVisualization(BACKDROP)
registerVisualization(BOARD)

const offeredTypes = (visibility?: Parameters<typeof visibleVisualizations>[0]) =>
  visibleVisualizations(visibility).map((plugin) => plugin.type)

describe('effectiveAudience', () => {
  it('treats a plugin that declares nothing as an analyst type', () => {
    expect(effectiveAudience(BOARD)).toBe('analyst')
    expect(effectiveAudience(BOARD, {})).toBe('analyst')
  })

  it('takes the plugin at its word when config is silent', () => {
    expect(effectiveAudience(BACKDROP)).toBe('internal')
    expect(effectiveAudience(BACKDROP, {})).toBe('internal')
  })

  // Both directions, because an instance disagreeing with a plugin author is
  // the whole reason the override exists. A deployment that does build reports
  // out of a backdrop should not have to fork the plugin to say so.
  it('lets config promote a type the plugin called internal', () => {
    expect(effectiveAudience(BACKDROP, { TEST_BACKDROP: 'analyst' })).toBe('analyst')
  })

  it('lets config demote a type the plugin left open', () => {
    expect(effectiveAudience(BOARD, { TEST_BOARD: 'internal' })).toBe('internal')
  })

  it('ignores an override aimed at some other type', () => {
    expect(effectiveAudience(BOARD, { SOMETHING_ELSE: 'internal' })).toBe('analyst')
  })
})

describe('internal types and the picker', () => {
  it('keeps an internal type out of what an analyst is offered', () => {
    const types = offeredTypes()
    expect(types).toContain('TEST_BOARD')
    expect(types).not.toContain('TEST_BACKDROP')
  })

  // The invariant that makes this safe to turn on. Audience is a statement
  // about the picker, so a wall slide or a dashboard widget already saved
  // against an internal type has to keep drawing.
  it('does not touch the lookup a saved visualization renders through', () => {
    expect(isRenderableComponent(getVisualization('TEST_BACKDROP')?.Renderer)).toBe(true)
    expect(getVisualization('TEST_BACKDROP')?.displayName).toBe('Backdrop')
  })

  it('offers an internal type once config promotes it', () => {
    expect(offeredTypes({ audience: { TEST_BACKDROP: 'analyst' } })).toContain('TEST_BACKDROP')
  })

  it('drops a core type once config demotes it', () => {
    expect(offeredTypes({ audience: { TABLE: 'internal' } })).not.toContain('TABLE')
    // Still registered, still renders. Only the picker changed.
    expect(isRenderableComponent(getVisualization('TABLE')?.Renderer)).toBe(true)
  })

  // The two rules compose rather than override each other, and the order does
  // not matter: naming an internal type in the allowlist is an operator saying
  // "this build has it", not "offer it".
  it('hides an internal type the allowlist names', () => {
    expect(offeredTypes({ enabled: ['TEST_BACKDROP', 'TEST_BOARD'] })).toEqual(['TEST_BOARD'])
  })

  it('hides a promoted type the allowlist leaves out', () => {
    expect(
      offeredTypes({ enabled: ['TEST_BOARD'], audience: { TEST_BACKDROP: 'analyst' } })
    ).toEqual(['TEST_BOARD'])
  })
})
