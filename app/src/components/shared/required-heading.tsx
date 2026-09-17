import type { ReactNode } from 'react'

import { RequiredMarker } from '@/components/ui/label'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

export function RequiredHeading({
  id,
  required = false,
  children,
}: {
  id: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-baseline">
      <h2 id={id} className={SUBSECTION_HEADING}>
        {children}
      </h2>
      {required ? <RequiredMarker /> : null}
    </div>
  )
}
