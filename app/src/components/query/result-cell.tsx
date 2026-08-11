'use client'

import { TableCell } from '@/components/ui/table'
import { useFormats } from '@/hooks/use-formats'
import {
  resolveImageCell,
  resolveLinkCell,
  type ColumnDisplayOptions,
} from '@/lib/visualizations/column-display'

interface ResultCellProps {
  value: unknown
  row: Record<string, unknown>
  /** The column's data type, used when nothing overrides how it is drawn. */
  columnType: string
  config?: ColumnDisplayOptions
}

/**
 * One table cell, drawn the way its column says to (Redash's `displayAs`).
 *
 * Every kind falls back to plain text when its template resolves to nothing.
 * A column marked as a link but never given a URL is not a link, and an anchor
 * that goes nowhere is worse than the value it replaced.
 */
export function ResultCell({ value, row, columnType, config }: ResultCellProps) {
  const formats = useFormats()
  const displayAs = config?.displayAs

  const text = () => {
    if (value == null) return 'null'
    if (displayAs === 'boolean') return String(Boolean(value))
    if (displayAs === 'datetime' || columnType === 'datetime') return formats.dateTime(value)
    if (columnType === 'date') return formats.date(value)
    if (displayAs === 'number' || columnType === 'float' || columnType === 'decimal' || columnType === 'integer') {
      return Number(value).toLocaleString()
    }
    return String(value)
  }

  if (config && displayAs === 'link') {
    const link = resolveLinkCell(config, row, value)
    if (link) {
      return (
        <TableCell className="max-w-[300px] truncate px-3 py-1.5 whitespace-nowrap">
          <a
            href={link.href}
            title={link.title}
            target={link.target}
            rel={link.rel}
            className="text-primary hover:underline"
          >
            {link.text}
          </a>
        </TableCell>
      )
    }
  }

  if (config && displayAs === 'image') {
    const image = resolveImageCell(config, row, value)
    if (image) {
      return (
        <TableCell className="px-3 py-1.5">
          {/* Not next/image: the URL comes from the query author at runtime, so
              there is no build-time host to configure a loader against. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt={image.alt}
            title={image.title}
            width={image.width}
            height={image.height}
            className="max-h-16 w-auto"
          />
        </TableCell>
      )
    }
  }

  return (
    <TableCell className="max-w-[300px] truncate px-3 py-1.5 whitespace-nowrap">{text()}</TableCell>
  )
}
