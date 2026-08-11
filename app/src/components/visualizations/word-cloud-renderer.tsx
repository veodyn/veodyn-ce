'use client'

import { useEffect, useMemo, useState } from 'react'
import cloud from 'd3-cloud'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { RedashWordCloudOptions } from '@/services/redash/types'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'
import { buildWordCloudModel, type WordDatum } from './word-cloud-model'

// The coordinate space the layout runs in, not a pixel size any more. d3-cloud
// still places words inside a SIZE x SIZE square and the viewBox still declares
// that square, but the svg below is sized as a percentage, so these are user
// units the browser maps onto whatever box the widget hands over.
const SIZE = 480

interface WordCloudRendererProps {
  visualization: MockVisualization
  data: QueryResultData
}

// d3-cloud's own Word type declares x/y/rotate as optional output fields, but
// its generic constraint (T extends Word) does not merge those onto our own
// word type automatically, so WordDatum alone types the 'end' callback's
// words without them. Declaring the input words as this superset gives the
// callback correctly typed placed positions with no unsafe cast.
interface CloudWord extends WordDatum {
  x?: number
  y?: number
  rotate?: number
}

export function WordCloudRenderer({ visualization, data }: WordCloudRendererProps) {
  const options = useMemo(() => (visualization.options ?? {}) as RedashWordCloudOptions, [visualization.options])
  const model = useMemo(() => buildWordCloudModel(options, data), [options, data])
  // Redash only draws the words d3-cloud actually placed (viz-lib's
  // word-cloud Renderer.tsx binds the 'end' event's own word list directly);
  // a word the layout could not fit is simply absent from that list, so this
  // state IS the placed set, with no fallback position for the rest.
  const [placedWords, setPlacedWords] = useState<CloudWord[]>([])

  useEffect(() => {
    // No words to lay out; the render below shows the "No words to display"
    // message in this case regardless of stale placedWords from a prior model.
    if (model.words.length === 0) return
    let cancelled = false
    try {
      const layout = cloud<CloudWord>()
        .size([SIZE, SIZE])
        .padding(2)
        .font('sans-serif')
        .rotate((w) => w.angle)
        .fontSize((w) => w.fontSize)
        .random(() => 0.5)
        .words(model.words.map((w) => ({ ...w })))
        .on('end', (words) => {
          if (cancelled) return
          setPlacedWords(words)
        })
      layout.start()
      return () => {
        cancelled = true
        layout.stop()
      }
    } catch {
      // This try/catch only guards the synchronous .start() setup call.
      // d3-cloud runs word placement inside its own internal timer/tick loop,
      // so a placement failure would surface later, in a timer callback,
      // outside this synchronous try/catch (and outside any React error
      // boundary). In practice that failure mode is essentially unreachable
      // in production: this effect is client-only (useEffect), so it never
      // runs during SSR/jsdom render, and 2D canvas is universally available
      // in real browsers. If setup did fail, placedWords simply stays empty
      // and nothing renders, matching Redash's own placed-only behavior.
      return () => {
        cancelled = true
      }
    }
  }, [model])

  if (!options.column) {
    return <div className="p-4 text-sm text-muted-foreground">Word cloud requires a word column.</div>
  }
  if (model.words.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No words to display.</div>
  }

  return (
    // Height, not the 400px this box used to hardcode: the svg's percentage
    // height needs a containing block whose height is definite, and now that
    // the drawing scales with the box, a surface that opts into filling its
    // space (the fill custom property) grows the words instead of leaving them
    // marooned in the middle of a taller empty panel. Flex rather than a plain
    // block so the svg is not an inline box on a text baseline, which would
    // push it a few pixels past the bottom of the height it was just given.
    <div className="p-4 flex" style={{ height: FILLABLE_PANEL_HEIGHT }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        // xMidYMid meet. `meet` scales the viewBox uniformly and keeps all of
        // it visible, so a word the layout placed near an edge still draws in
        // a tile whose aspect ratio is not square; `slice` would fill that
        // tile edge to edge but crop exactly those words away, and the layout
        // has no notion of which words are safe to lose. xMid/yMid puts the
        // leftover space on both sides of the square rather than pinning it to
        // a corner, which is what the flex centering used to do by hand.
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Word cloud"
      >
        <g transform={`translate(${SIZE / 2}, ${SIZE / 2})`}>
          {placedWords.map((word) => (
            <text
              key={word.text}
              textAnchor="middle"
              fill={resolveSeriesColor(word.text, word.rank)}
              fontSize={word.fontSize}
              transform={`translate(${word.x ?? 0}, ${word.y ?? 0}) rotate(${word.rotate ?? 0})`}
            >
              {word.text}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}
