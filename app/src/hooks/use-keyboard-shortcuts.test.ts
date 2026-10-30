import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from './use-keyboard-shortcuts'

describe('useKeyboardShortcuts', () => {
  it('runs the shortcut that matches the pressed combination', () => {
    const save = vi.fn()
    renderHook(() => useKeyboardShortcuts({ 'mod+s': save }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true }))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('ignores a keydown without a key, as autofill sends', () => {
    const save = vi.fn()
    renderHook(() => useKeyboardShortcuts({ 'mod+s': save }))
    const autofill = new Event('keydown') as KeyboardEvent
    expect(() => window.dispatchEvent(autofill)).not.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
