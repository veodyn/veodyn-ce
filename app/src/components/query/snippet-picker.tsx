'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useConfig } from '@/components/config/config-provider'
import { useQuerySnippets } from '@/hooks/use-query-snippets'

/**
 * Saved snippets, clickable into the editor buffer. The browsable half of two
 * routes in; the other is trigger expansion via a Monaco completion provider
 * (see query-editor.tsx).
 *
 * Gated on the same flag as the route: `/query-snippets` calls notFound() when
 * features.query_snippets is off, so an ungated panel would link into a 404.
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
