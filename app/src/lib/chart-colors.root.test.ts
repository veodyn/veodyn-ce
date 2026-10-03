import { afterEach, describe, expect, it } from 'vitest'
import { getSequentialScaleHex, readCssVarHex, resolveChartHex } from './chart-colors'

function scopedRoot(vars: Record<string, string>): HTMLElement {
  const root = document.createElement('div')
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('style')
})

describe('computed colours read from a scoped root', () => {
  it('reads a variable set on the given root rather than the document', () => {
    document.documentElement.style.setProperty('--muted', '#000000')
    const root = scopedRoot({ '--muted': '#123456' })

    expect(readCssVarHex('--muted', '#ffffff', root)).toBe('#123456')
  })

  it('still reads the document when no root is given', () => {
    document.documentElement.style.setProperty('--muted', '#abcdef')

    expect(readCssVarHex('--muted', '#ffffff')).toBe('#abcdef')
  })

  it('resolves a chart slot from the given root', () => {
    const root = scopedRoot({ '--chart-1': '#ff0000' })

    expect(resolveChartHex(0, root)).toBe('#ff0000')
  })

  it('builds a sequential scale whose top end is the root chart colour', () => {
    const root = scopedRoot({ '--card': '#ffffff', '--chart-1': '#ff0000' })

    expect(getSequentialScaleHex(0, 10, root)(10)).toBe('rgb(255, 0, 0)')
  })
})
