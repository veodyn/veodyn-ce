// Argument checks for the MCP tools.
//
// A model composes these calls, so a wrong type is an ordinary event rather
// than a bug. Each throws a TypeError naming the argument, which dispatch turns
// into a tool error the model can read and correct.

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`${key} must be an integer`)
  }
  return value
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${key} must be a non-empty string`)
  }
  return value.trim()
}
