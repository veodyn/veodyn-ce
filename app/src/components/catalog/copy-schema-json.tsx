'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import type { DatasetColumn } from '@/types/catalog'

/**
 * The schema table, as JSON, on the clipboard.
 *
 * The table is the thing people retype into a migration, a fixture or a
 * client type, and retyping thirty ClickHouse types by hand is where the
 * mistakes come from. This hands over exactly what the table shows and
 * nothing else: no dataset name, no row count, no freshness, because the
 * paste target is a column list.
 *
 * Follows `CodeBlock`'s copy affordance rather than inventing one, including
 * its reason for putting the confirmation in the tooltip: the tooltip is
 * already open when the click lands, and a tick on its own leaves a reader
 * unsure whether it copied or merely acknowledged.
 */
export function CopySchemaJson({ schema }: { schema: DatasetColumn[] }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    // `description` is optional on the type and absent on most warehouse
    // columns. Emitted only where there is one, so a consumer reads a missing
    // key as "no description" rather than having to tell `null`, `""` and
    // absent apart for a field that only ever means one of them.
    const asJson = schema.map((column) => ({
      name: column.name,
      type: column.type,
      ...(column.description ? { description: column.description } : {}),
    }))
    await navigator.clipboard.writeText(JSON.stringify(asJson, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <IconButton
      tooltip={copied ? 'Copied' : 'Copy schema as JSON'}
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-status-fresh" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </IconButton>
  )
}
