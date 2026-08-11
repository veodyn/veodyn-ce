import { describe, expect, it } from 'vitest'
import { nextRovingIndices } from './use-heatmap-grid-interaction'

// Task 5 fix round 3, important finding C: the DOM-level "moves ArrowLeft and
// ArrowUp too" test in heatmap-renderer-interaction.test.tsx claimed to cover
// the min-edge clamp (Math.max(_, 0)) but could not: at index 0, a WORKING
// clamp and a clamp that was silently dropped produce the identical
// DOM-observable outcome (xCategories[-1] is undefined, and focusCellAt's
// optional chaining no-ops on it, leaving focus exactly where a correct
// clamp would also have left it). nextRovingIndices is the pure function
// extracted specifically so the clamp is a plain input/output assertion
// instead.
describe('nextRovingIndices', () => {
  it('clamps ArrowLeft/ArrowUp at index 0, returning 0, not -1', () => {
    expect(nextRovingIndices('ArrowLeft', 0, 0, 3, 2)).toEqual({ nextXi: 0, nextYi: 0 })
    expect(nextRovingIndices('ArrowUp', 0, 0, 3, 2)).toEqual({ nextXi: 0, nextYi: 0 })
  })

  it('clamps ArrowRight/ArrowDown at the last index, not overshooting past it', () => {
    expect(nextRovingIndices('ArrowRight', 2, 1, 3, 2)).toEqual({ nextXi: 2, nextYi: 1 })
    expect(nextRovingIndices('ArrowDown', 2, 1, 3, 2)).toEqual({ nextXi: 2, nextYi: 1 })
  })

  it('moves by exactly one index per direction away from either edge', () => {
    expect(nextRovingIndices('ArrowRight', 0, 0, 3, 2)).toEqual({ nextXi: 1, nextYi: 0 })
    expect(nextRovingIndices('ArrowLeft', 1, 0, 3, 2)).toEqual({ nextXi: 0, nextYi: 0 })
    expect(nextRovingIndices('ArrowDown', 0, 0, 3, 2)).toEqual({ nextXi: 0, nextYi: 1 })
    expect(nextRovingIndices('ArrowUp', 0, 1, 3, 2)).toEqual({ nextXi: 0, nextYi: 0 })
  })

  it('returns null for a non-arrow key, so the caller does not preventDefault or move focus', () => {
    expect(nextRovingIndices('Enter', 0, 0, 3, 2)).toBeNull()
    expect(nextRovingIndices('Tab', 0, 0, 3, 2)).toBeNull()
  })

  it('returns null for an empty axis instead of naming index -1', () => {
    // Math.min(xi + 1, xLength - 1) is -1 when xLength is 0, so the clamped
    // "next" index named a cell that cannot exist. Harmless downstream today
    // (the caller's lookup finds no node), but this function is where the
    // clamp lives now, so the empty-axis answer is its own to get right.
    expect(nextRovingIndices('ArrowRight', 0, 0, 0, 0)).toBeNull()
    expect(nextRovingIndices('ArrowDown', 0, 0, 0, 0)).toBeNull()
    expect(nextRovingIndices('ArrowRight', 0, 0, 0, 2)).toBeNull()
    expect(nextRovingIndices('ArrowDown', 0, 0, 3, 0)).toBeNull()
  })
})
