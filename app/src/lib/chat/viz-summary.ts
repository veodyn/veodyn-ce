type Options = Record<string, unknown>

export interface OptionChange {
  key: string
  before: string | null
  after: string | null
}

function shown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function optionChanges(before: Options, after: Options): OptionChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const changes: OptionChange[] = []
  for (const key of keys) {
    const was = Object.hasOwn(before, key) ? shown(before[key]) : null
    const now = Object.hasOwn(after, key) ? shown(after[key]) : null
    if (was !== now) changes.push({ key, before: was, after: now })
  }
  return changes
}
