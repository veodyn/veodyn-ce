import { describe, expect, it } from 'vitest'
import { evenGridColumns } from './grid-columns'

describe('evenGridColumns', () => {
  it('leaves a lone child on the single base column', () => {
    expect(evenGridColumns(1)).toBe('')
    expect(evenGridColumns(0)).toBe('')
  })

  it('splits two and four evenly rather than leaving a gap or an orphan row', () => {
    expect(evenGridColumns(2)).toBe('md:grid-cols-2')
    expect(evenGridColumns(4)).toBe('md:grid-cols-2')
  })

  it('caps at three columns', () => {
    expect(evenGridColumns(3)).toBe('md:grid-cols-2 lg:grid-cols-3')
    expect(evenGridColumns(9)).toBe('md:grid-cols-2 lg:grid-cols-3')
  })

  it('emits whole class names so Tailwind can see them', () => {
    for (const count of [0, 1, 2, 3, 4, 5]) {
      expect(evenGridColumns(count)).not.toContain('${')
    }
  })
})
