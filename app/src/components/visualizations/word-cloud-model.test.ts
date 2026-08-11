import { describe, expect, it } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { buildWordCloudModel } from './word-cloud-model'

const textData: QueryResultData = {
  columns: [{ name: 'text', friendly_name: 'text', type: 'string' }],
  rows: [{ text: 'bus bus bus' }, { text: 'train train' }, { text: 'tram' }],
}

describe('buildWordCloudModel', () => {
  it('counts word frequencies and scales font size between the count extremes', () => {
    const model = buildWordCloudModel({ column: 'text' }, textData)
    const bus = model.words.find((w) => w.text === 'bus')
    const tram = model.words.find((w) => w.text === 'tram')
    expect(bus?.count).toBe(3)
    expect(tram?.count).toBe(1)
    expect(bus?.fontSize).toBeGreaterThan(tram?.fontSize ?? 0)
    // Redash's font scale range is 10..100 (viz-lib word-cloud Renderer.tsx):
    // the top word by count scales to 100, the least frequent to 10.
    expect(model.words[0].text).toBe('bus')
    expect(model.words[0].fontSize).toBe(100)
    expect(tram?.fontSize).toBe(10)
  })

  it('reads a precomputed frequency column when provided', () => {
    const data: QueryResultData = {
      columns: [
        { name: 'word', friendly_name: 'word', type: 'string' },
        { name: 'n', friendly_name: 'n', type: 'integer' },
      ],
      rows: [
        { word: 'alpha', n: 9 },
        { word: 'beta', n: 3 },
      ],
    }
    const model = buildWordCloudModel({ column: 'word', frequenciesColumn: 'n' }, data)
    expect(model.words.map((w) => w.text)).toEqual(['alpha', 'beta'])
    expect(model.words[0].count).toBe(9)
  })

  it('applies the word-length limit', () => {
    const model = buildWordCloudModel({ column: 'text', wordLengthLimit: { min: 4 } }, textData)
    expect(model.words.some((w) => w.text === 'bus')).toBe(false)
    expect(model.words.some((w) => w.text === 'train')).toBe(true)
  })

  it('applies the word-count (frequency) limit', () => {
    // bus=3, train=2, tram=1; min frequency 2 keeps bus and train, drops tram.
    const model = buildWordCloudModel({ column: 'text', wordCountLimit: { min: 2 } }, textData)
    const texts = model.words.map((w) => w.text)
    expect(texts).toContain('bus')
    expect(texts).toContain('train')
    expect(texts).not.toContain('tram')
  })

  it('degrades to an empty model without throwing when the column is missing or data is empty', () => {
    const emptyData: QueryResultData = { columns: [], rows: [] }
    expect(() => buildWordCloudModel({}, textData)).not.toThrow()
    expect(buildWordCloudModel({}, textData).words).toEqual([])
    expect(buildWordCloudModel({ column: 'text' }, emptyData).words).toEqual([])
  })

  it('alternates word angles between 0 and 90 by rank, and assigns rank from sorted order', () => {
    const model = buildWordCloudModel({ column: 'text' }, textData)
    expect(model.words[0].rank).toBe(0)
    expect(model.words[0].angle).toBe(0)
    expect(model.words[1].rank).toBe(1)
    expect(model.words[1].angle).toBe(90)
    expect(model.words[2].rank).toBe(2)
    expect(model.words[2].angle).toBe(0)
  })

  it("keeps a surviving word's pre-filter rank, angle, and font size stable when a higher-ranked word is removed by a length limit", () => {
    // 'a' (count 10, length 1) ranks first and would seed rank 0 / angle 0;
    // removing it via wordLengthLimit must not shift 'bb' and 'ccc' down to
    // take its rank, angle, or size, per Redash's rank-before-filter contract.
    const rankData: QueryResultData = {
      columns: [
        { name: 'word', friendly_name: 'word', type: 'string' },
        { name: 'n', friendly_name: 'n', type: 'integer' },
      ],
      rows: [
        { word: 'a', n: 10 },
        { word: 'bb', n: 6 },
        { word: 'ccc', n: 2 },
      ],
    }
    const unfiltered = buildWordCloudModel({ column: 'word', frequenciesColumn: 'n' }, rankData)
    const bbBefore = unfiltered.words.find((w) => w.text === 'bb')
    const cccBefore = unfiltered.words.find((w) => w.text === 'ccc')

    const filtered = buildWordCloudModel(
      { column: 'word', frequenciesColumn: 'n', wordLengthLimit: { min: 2 } },
      rankData
    )
    expect(filtered.words.some((w) => w.text === 'a')).toBe(false)
    expect(filtered.words.find((w) => w.text === 'bb')).toEqual(bbBefore)
    expect(filtered.words.find((w) => w.text === 'ccc')).toEqual(cccBefore)
  })
})
