'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IconButton } from '@/components/shared/icon-button'
import { CopyIcon, CopyStatus, copyTooltip } from '@/components/shared/copy-status'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

interface InputWithCopyProps {
  value: string
  className?: string
  label?: string
}

export function InputWithCopy({ value, className, label }: InputWithCopyProps) {
  const { status, copy } = useCopyToClipboard()
  const inputId = useId()

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
          tooltip={copyTooltip(status, 'Copy to clipboard')}
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={() => copy(value)}
        >
          <CopyIcon status={status} className="h-4 w-4" />
        </IconButton>
        <CopyStatus status={status} />
      </div>
    </div>
  )
}
