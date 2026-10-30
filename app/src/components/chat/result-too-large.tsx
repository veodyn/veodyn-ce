import { FileWarning } from 'lucide-react'
import { CHAT_RESULT_MAX_MEBIBYTES } from '@/lib/chat/result-cap'

export const RESULT_TOO_LARGE_LABEL = 'Result too large to load'

export function ResultTooLarge() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
      <FileWarning className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">This result is over the {CHAT_RESULT_MAX_MEBIBYTES} MB the chat loads in your browser.</p>
        <p className="text-pretty text-muted-foreground">
          It was not downloaded in full or drawn. The assistant was asked to narrow the query with a filter, an
          aggregate or a LIMIT.
        </p>
      </div>
    </div>
  )
}
