/**
 * Column classes for a grid whose child count is only known at render time.
 *
 * A fixed `md:grid-cols-3` is wrong for a section that sometimes has one or two
 * children: the row keeps the third slot's width, so a single card renders at a
 * third of the width with two thirds of empty space beside it, and the section
 * no longer lines up with the full-width sections above and below it.
 *
 * Tailwind resolves class names statically, so the count maps to whole classes
 * rather than an interpolated `grid-cols-${n}`.
 */
export function evenGridColumns(count: number): string {
  // Four splits 2x2 rather than 3+1, which would leave a lone card on the
  // second row: the same ragged edge this helper exists to avoid.
  if (count <= 1) return ''
  if (count === 2 || count === 4) return 'md:grid-cols-2'
  return 'md:grid-cols-2 lg:grid-cols-3'
}
