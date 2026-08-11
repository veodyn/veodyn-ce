/**
 * A value the surrounding code already knows is there, checked rather than
 * asserted.
 *
 * `x!` tells the compiler to stop asking. It does not say what the program
 * should do when the value turns out to be missing anyway, so a wrong
 * assumption becomes an `undefined` travelling through code typed as if it were
 * present, and it surfaces somewhere with no connection to the cause. This
 * fails at the point the assumption breaks, and names it.
 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`${what} was expected to be present, and was not`)
  return value
}
