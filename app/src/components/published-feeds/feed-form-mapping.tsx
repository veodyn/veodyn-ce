'use client'

import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { GtfsField } from '@/lib/gtfs-fields'
import { ColumnMapEditor } from './column-map-editor'
import { StaticReferenceField } from './static-reference-field'
import type { StaticGtfsRefControl } from './static-gtfs-ref'
import type { EntityNeeds } from '@/types/published-feed'

interface MappingSectionProps {
  needs: EntityNeeds
  staticRef: StaticGtfsRefControl
  columns: string[]
  fields: GtfsField[]
  selection: Record<string, string | null>
  onSelectionChange: (field: string, column: string | null) => void
  fieldErrors: Record<string, string>
}

export function MappingSection({
  needs,
  staticRef,
  columns,
  fields,
  selection,
  onSelectionChange,
  fieldErrors,
}: MappingSectionProps) {
  if (!needs.staticReference && !needs.columnMap) return null

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>Mapping</h2>
      {needs.staticReference && <StaticReferenceField control={staticRef} />}
      {needs.columnMap && (
        <ColumnMapEditor
          columns={columns}
          fields={fields}
          selection={selection}
          onChange={onSelectionChange}
          fieldErrors={fieldErrors}
        />
      )}
    </div>
  )
}
