'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/shared/icon-button'

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
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('relative group', className)}>
      <pre className="bg-muted rounded-md p-4 overflow-x-auto text-sm font-mono">
        <code data-language={language}>{code}</code>
      </pre>
      <IconButton
        // The tooltip is already open when the click lands, so it is also where
        // the confirmation belongs: the tick alone leaves a reader guessing
        // whether it copied or merely acknowledged.
        tooltip={copied ? 'Copied' : 'Copy code'}
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={handleCopy}
        className="absolute top-2 right-2"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-status-fresh" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </IconButton>
    </div>
  )
}
