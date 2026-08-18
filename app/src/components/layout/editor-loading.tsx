/**
 * What the two query-editor routes show while their segment is on the way.
 *
 * A sibling of PageLoading rather than a knob on it: PageLoading renders inside
 * PageContainer's `p-6` and max width, while query-editor-page.tsx is a
 * full-height `flex flex-col h-screen`. It announces because every route in
 * this app renders the same document title, so Next's route announcer never
 * fires and a silent skeleton is silence for the whole wait.
 */
export function EditorLoading() {
  return (
    <div
      role="status"
      aria-label="Loading the query editor"
      className="flex h-screen flex-col motion-safe:animate-pulse"
    >
      <div className="flex items-center justify-between border-b p-4">
        <div className="h-6 w-64 rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-9 w-20 rounded-md bg-muted/60" />
          <div className="h-9 w-20 rounded-md bg-muted" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Schema rail */}
        <div className="w-64 shrink-0 space-y-2 border-r p-4">
          <div className="h-8 w-full rounded bg-muted/60" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 w-full rounded bg-muted/40" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* SQL pane */}
          <div className="min-h-0 flex-1 space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 w-2/3 rounded bg-muted/60" />
            ))}
          </div>
          {/* Results pane */}
          <div className="min-h-0 flex-1 space-y-3 border-t p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 w-full rounded bg-muted/40" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
