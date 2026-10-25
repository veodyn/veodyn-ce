import { describe, expect, it } from 'vitest'
import { toModelParameter, toNativeParameter, toNativeParameters } from './query-parameters'

describe('toNativeParameter', () => {
  it('converts an enum multi with single quote to node multiValuesOptions', () => {
    const native = toNativeParameter({ name: 'day', type: 'enum', enumOptions: 'a\nb', multi: true, quote: 'single' })
    expect(native).toEqual({
      name: 'day',
      type: 'enum',
      enumOptions: 'a\nb',
      multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
    })
    expect('multi' in native).toBe(false)
    expect('quote' in native).toBe(false)
  })

  it('maps none and double quotes', () => {
    expect(toNativeParameter({ name: 'a', type: 'enum', multi: true, quote: 'none' }).multiValuesOptions).toEqual({
      prefix: '',
      suffix: '',
      separator: ',',
    })
    expect(toNativeParameter({ name: 'a', type: 'enum', multi: true, quote: 'double' }).multiValuesOptions).toEqual({
      prefix: '"',
      suffix: '"',
      separator: ',',
    })
  })

  it('sends no multiValuesOptions for a single-value parameter', () => {
    expect('multiValuesOptions' in toNativeParameter({ name: 'a', type: 'text', multi: false })).toBe(false)
  })

  it('keeps native keys the current definition carries and drops its multi options when multi is false', () => {
    const current = { name: 'a', type: 'enum', parentQueryId: 9, multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' } }
    const native = toNativeParameter({ name: 'a', type: 'enum', title: 'A', multi: false }, current)
    expect(native).toEqual({ name: 'a', type: 'enum', parentQueryId: 9, title: 'A' })
  })

  it('keeps the current multi options when the replacement does not mention multi', () => {
    const multiValuesOptions = { prefix: "'", suffix: "'", separator: ',' }
    const native = toNativeParameter({ name: 'a', type: 'enum' }, { name: 'a', type: 'enum', multiValuesOptions })
    expect(native.multiValuesOptions).toEqual(multiValuesOptions)
  })

  it('saves no value when the replacement omits it, and keeps a native parentQueryId', () => {
    const current = { name: 'p', type: 'text', value: 'old', title: 'P', enumOptions: 'a', queryId: 3, parentQueryId: 9 }
    const native = toNativeParameter({ name: 'p', type: 'text' }, current)
    expect(native).toEqual({ name: 'p', type: 'text', parentQueryId: 9 })
  })

  it('matches current definitions by name', () => {
    const converted = toNativeParameters([{ name: 'b', type: 'text' }], [{ name: 'a', type: 'text', global: true }])
    expect(converted).toEqual([{ name: 'b', type: 'text' }])
  })
})

describe('toModelParameter', () => {
  it('reads multiValuesOptions back as multi and quote', () => {
    const model = toModelParameter({
      name: 'a',
      type: 'enum',
      parentQueryId: 9,
      multiValuesOptions: { prefix: '"', suffix: '"', separator: ',' },
    })
    expect(model).toEqual({ name: 'a', type: 'enum', multi: true, quote: 'double' })
  })
})
