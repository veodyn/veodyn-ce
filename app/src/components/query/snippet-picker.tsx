'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/components/config/config-provider'
import { useQuerySnippets } from '@/hooks/use-query-snippets'

/**
 * Saved snippets, clickable into the editor buffer.
 *
 * The browsable half of two routes in. Typing a snippet's trigger word in the
 * editor now expands it, the way Redash does it through Ace and this product
 * does it through a Monaco completion provider (see query-editor.tsx). This
 * panel stays because trigger expansion only helps someone who already knows
 * the trigger: a snippets page you cannot insert from is a notepad, and a
 * trigger you cannot discover is one you will never type.
 *
 * Gated on the same flag as the route. `/query-snippets` is a server-rendered
 * gate that calls notFound() when features.query_snippets is off, so on an
 * instance with snippets switched off this panel was advertising a surface that
 * did not exist: it sat on every query screen reading "No snippets yet. Create
 * one." and the link answered with the bare Next 404. Nothing could ever
 * populate the list either, since the only page that writes a snippet is the
 * one behind that 404.
 */
export function SnippetPicker({ onInsert }: { onInsert: (text: string) => void }) {
  const { features } = useConfig()
  const { data: snippets } = useQuerySnippets()

  if (!features.query_snippets) return null

  return (
    <div className="border-t p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Snippets</div>
      {snippets && snippets.length > 0 ? (
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {snippets.map((snippet) => (
            // The whole row is the control, and its accessible name carries the
            // trigger, so the picker is navigable without reading the body.
            <Button
              key={snippet.id}
              type="button"
              variant="ghost"
              onClick={() => onInsert(snippet.snippet)}
              className="h-auto w-full flex-col items-start gap-0 px-1.5 py-1 font-normal"
            >
              <span className="font-mono text-xs">{snippet.trigger}</span>
              {snippet.description && (
                <span className="w-full truncate text-left text-xs text-muted-foreground">
                  {snippet.description}
                </span>
              )}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No snippets yet.{' '}
          <Link href="/query-snippets" className="text-primary hover:underline">
            Create one
          </Link>
          .
        </p>
      )}
    </div>
  )
}
