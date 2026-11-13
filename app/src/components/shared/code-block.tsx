'use client'

import { cn } from '@/lib/utils'
import { IconButton } from '@/components/shared/icon-button'
import { CopyIcon, CopyStatus, copyTooltip } from '@/components/shared/copy-status'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

/**
 * A block of code with a copy button that is actually visible.
 *
 * The button used to be `opacity-0` until hover. Both callers are Connect pages
 * whose entire job is handing over strings to copy, and a control nobody can
 * see is not one: the pages read as offering no way to copy anything. Keyboard
 * users were covered by a `focus-visible` override, which is the tell that the
 * hiding was a style rather than a decision about the affordance.
 */
export function CodeBlock({ code, language = 'sql', className }: CodeBlockProps) {
  const { status, copy } = useCopyToClipboard()

  return (
    <div className={cn('relative group', className)}>
      <pre className="bg-muted rounded-md p-4 overflow-x-auto text-sm font-mono">
        <code data-language={language}>{code}</code>
      </pre>
      <IconButton
        tooltip={copyTooltip(status, 'Copy code')}
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => copy(code)}
        className="absolute top-2 right-2"
      >
        <CopyIcon status={status} className="h-3.5 w-3.5" />
      </IconButton>
      <CopyStatus status={status} />
    </div>
  )
}
