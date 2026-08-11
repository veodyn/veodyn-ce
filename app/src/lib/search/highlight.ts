// Splits a title so the part matching the search term can be emphasized.
// Matching is a literal, case-insensitive indexOf rather than a RegExp, so a
// term containing regex metacharacters is safe by construction.

export interface MatchSegment {
  text: string
  matched: boolean
}

export function splitOnMatch(text: string, needle: string): MatchSegment[] {
  const trimmed = needle.trim()
  if (!trimmed) return [{ text, matched: false }]

  const index = text.toLowerCase().indexOf(trimmed.toLowerCase())
  if (index === -1) return [{ text, matched: false }]

  const segments: MatchSegment[] = []
  if (index > 0) segments.push({ text: text.slice(0, index), matched: false })
  segments.push({ text: text.slice(index, index + trimmed.length), matched: true })
  const rest = text.slice(index + trimmed.length)
  if (rest) segments.push({ text: rest, matched: false })
  return segments
}
