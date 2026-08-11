// The markdown a dashboard text box accepts, parsed to nodes.
//
// Parsed, not string-replaced. The previous renderer built an HTML string with
// a handful of regexes and handed it to dangerouslySetInnerHTML, in two places
// that had drifted into separate copies of the same code. Nothing escaped the
// source, so a text box was a stored-XSS surface: whatever an author typed ran
// for everybody who opened the dashboard. Producing nodes instead makes that
// impossible by construction rather than by remembering to escape, which is the
// same reason the report narrative works this way (components/reports/narrative.tsx).
//
// Inline marks come from richtext.ts rather than a second parser here.
// That one already decides what a safe link is (`isSafeLink`), and one audited
// answer used twice beats two answers that agree until one of them is edited.

import { parseInlineText, parseRichText, type RichInline, type RichNode } from '@/lib/richtext'

export type TextboxNode = RichNode | { type: 'heading'; level: 1 | 2 | 3; children: RichInline[] }

// CommonMark requires the space: "##Text" is not a heading, and reading it as
// one would put this renderer at odds with every other markdown tool the
// author uses. Levels stop at three because a text box is a widget, not a
// document, and h4 inside a dashboard card has nothing to be subordinate to.
const HEADING = /^(#{1,3})[ \t]+(.*)$/
// A hash opening a line with no space after it: not a heading, and almost
// always meant to be one. The character after the run must be neither a space
// nor another hash: with a bare \S the pattern backtracks, matching the second
// hash of a perfectly good "## Title" and warning about correct markdown.
const HEADING_MISSING_SPACE = /^#{1,6}[^\s#]/m

export function missingHeadingSpace(source: string): boolean {
  return HEADING_MISSING_SPACE.test(source)
}

// The inline content of one line. Straight to the inline parser, never
// through parseRichText: a heading is a line, but its TEXT can still look like
// a block to a block parser. "# - secret" comes back from that one as a list,
// and taking only the paragraph case dropped the author's words entirely,
// rendering an empty heading.
function inlineOf(text: string): RichInline[] {
  return parseInlineText(text)
}

export function parseTextbox(source: string): TextboxNode[] {
  const nodes: TextboxNode[] = []
  let pending: string[] = []
  // CRLF is normalised first. Splitting on '\n' alone leaves a '\r' at the end
  // of every line, and `.` matches a carriage return, so a heading pasted from
  // a Windows editor carried one into its own text.
  const lines = source.replace(/\r\n?/g, '\n').split('\n')

  // A heading is a single line, so the lines around it stay one block and are
  // parsed together: splitting the whole source on blank lines first would
  // glue a heading to the paragraph under it.
  const flush = () => {
    const block = pending.join('\n').trim()
    pending = []
    if (block !== '') nodes.push(...parseRichText(block))
  }

  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (!heading) {
      pending.push(line)
      continue
    }
    flush()
    nodes.push({
      type: 'heading',
      level: heading[1].length as 1 | 2 | 3,
      children: inlineOf(heading[2]),
    })
  }
  flush()

  return nodes
}
