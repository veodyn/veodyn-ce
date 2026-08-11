import { describe, expect, it } from 'vitest'
import { compileVisualQuery } from '@/lib/visual-query'
import type { VisualQuerySpec } from '@/types/ai'
import { parseLimit } from './visual-builder-model'

describe('parseLimit', () => {
  it('reads a plain non-negative integer', () => {
    expect(parseLimit('100')).toBe(100)
    expect(parseLimit('0')).toBe(0)
  })

  it('treats an emptied field as no limit', () => {
    expect(parseLimit('')).toBe(0)
    expect(parseLimit('   ')).toBe(0)
  })

  it('does not silently truncate scientific or fractional input to 1', () => {
    // parseInt('1e3', 10) was 1 and parseInt('1.9', 10) was 1: a wrong LIMIT 1
    // that ran without warning. Neither is a plain integer, so both are refused.
    expect(parseLimit('1e3')).not.toBe(1)
    expect(parseLimit('1.9')).not.toBe(1)
  })

  it('hands the compiler a value it refuses for a non-integer limit', () => {
    const base = { dataset: 'trips' } as VisualQuerySpec
    expect(() => compileVisualQuery({ ...base, limit: parseLimit('1e3') })).toThrow()
    expect(() => compileVisualQuery({ ...base, limit: parseLimit('1.9') })).toThrow()
    // A real integer still compiles to that LIMIT.
    expect(compileVisualQuery({ ...base, limit: parseLimit('250') })).toContain('LIMIT 250')
  })
})
