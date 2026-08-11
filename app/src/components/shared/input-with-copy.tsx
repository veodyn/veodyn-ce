'use client'

import { useId, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IconButton } from '@/components/shared/icon-button'

interface InputWithCopyProps {
  value: string
  className?: string
  label?: string
}

export function InputWithCopy({ value, className, label }: InputWithCopyProps) {
  const [copied, setCopied] = useState(false)
  const inputId = useId()

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={className}>
      {label && (
        <Label htmlFor={inputId} className="mb-1 block">
          {label}
        </Label>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="text"
          readOnly
          value={value}
          className="flex-1 h-9 px-3 bg-muted text-sm font-mono"
        />
        <IconButton
          tooltip={copied ? 'Copied' : 'Copy to clipboard'}
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-4 w-4 text-status-fresh" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </IconButton>
      </div>
    </div>
  )
}
