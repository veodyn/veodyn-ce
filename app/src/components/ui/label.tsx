import * as React from 'react'

import { cn } from '@/lib/utils'

const REQUIRED_MARK = '*'

function RequiredMarker() {
  return (
    <span aria-hidden="true" data-slot="required-marker" className="ml-1 text-destructive/70">
      {REQUIRED_MARK}
    </span>
  )
}

function Label({
  className,
  required = false,
  children,
  ...props
}: React.ComponentProps<'label'> & { required?: boolean }) {
  return (
    <label
      data-slot="label"
      className={cn('text-sm font-medium leading-none', className)}
      {...props}
    >
      {children}
      {required ? <RequiredMarker /> : null}
    </label>
  )
}

export { Label, RequiredMarker }
