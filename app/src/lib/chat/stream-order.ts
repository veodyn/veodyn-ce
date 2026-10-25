function streamOrder(id: string): [number, number] {
  const [time, seq] = id.split('-').map(Number)
  return [time || 0, seq || 0]
}

export function isAfter(id: string, previous: string | null): boolean {
  if (previous === null) return true
  const [a, b] = streamOrder(id)
  const [c, d] = streamOrder(previous)
  return a > c || (a === c && b > d)
}
