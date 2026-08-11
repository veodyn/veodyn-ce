import type { QueryResultData } from '@/lib/mock-data'
import type { RedashWordCloudOptions } from '@/services/redash/types'

export interface WordDatum {
  text: string
  count: number
  fontSize: number
  angle: number
  // Stable rank in the full count-desc ranking, assigned BEFORE the length
  // and count limits below choose which words survive. The renderer keys
  // both the size scale and the color palette off this, not the survivors'
  // post-filter array index, so dropping a high-ranked word never re-colors
  // or re-rotates the words that remain.
  rank: number
}

export interface WordCloudModel {
  words: WordDatum[]
}

// Matches Redash's word-cloud font scale (viz-lib's word-cloud Renderer.tsx,
// prepareWords: d3.scale.linear().domain([min, max]).range([10, 100])).
const MIN_FONT = 10
const MAX_FONT = 100

function countFromText(rows: Record<string, unknown>[], column: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const words = String(row[column] ?? '')
      .split(/\s+/)
      .filter(Boolean)
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

function countFromColumn(
  rows: Record<string, unknown>[],
  wordColumn: string,
  frequencyColumn: string
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const count = Number(row[frequencyColumn])
    if (!Number.isFinite(count) || count <= 0) continue
    counts.set(String(row[wordColumn] ?? ''), count)
  }
  return counts
}

export function buildWordCloudModel(options: RedashWordCloudOptions, data: QueryResultData): WordCloudModel {
  const column = options.column
  if (!column) return { words: [] }

  const counts = options.frequenciesColumn
    ? countFromColumn(data.rows, column, options.frequenciesColumn)
    : countFromText(data.rows, column)

  const entries = Array.from(counts.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || b.text.length - a.text.length)

  if (entries.length === 0) return { words: [] }

  const values = entries.map((e) => e.count)
  const min = Math.min(...values)
  const max = Math.max(...values)

  // Assign size, angle, and rank from the FULL ranking first, then filter.
  // A word removed by wordLengthLimit/wordCountLimit below must not shift
  // the rank (and therefore the size/angle/color) of the words that remain.
  const ranked: WordDatum[] = entries.map(({ text, count }, rank) => {
    const t = max === min ? 1 : (count - min) / (max - min)
    return {
      text,
      count,
      fontSize: Math.round(MIN_FONT + (MAX_FONT - MIN_FONT) * t),
      angle: (rank % 2) * 90,
      rank,
    }
  })

  const lengthLimit = options.wordLengthLimit ?? {}
  const countLimit = options.wordCountLimit ?? {}

  const words = ranked.filter(({ text, count }) => {
    const lengthOk =
      (lengthLimit.min == null || text.length >= lengthLimit.min) &&
      (lengthLimit.max == null || text.length <= lengthLimit.max)
    const countOk =
      (countLimit.min == null || count >= countLimit.min) && (countLimit.max == null || count <= countLimit.max)
    return lengthOk && countOk
  })

  return { words }
}
