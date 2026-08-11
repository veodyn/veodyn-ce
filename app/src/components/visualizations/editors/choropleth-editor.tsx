'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { QueryResultColumn } from '@/lib/mock-data'
import type { RedashChoroplethOptions } from '@/services/redash/types'

interface ChoroplethEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  onChange: (options: Record<string, unknown>) => void
}

// The renderer resolves geometry through useVizGeoJson, which fetches the
// same-origin static asset /geo/<mapType>.geojson. public/geo/ ships exactly
// one file, so world-countries is the only value that can load; a longer list
// would offer map types whose fetch 404s. Add an entry here when an asset
// lands beside it.
const MAP_TYPES = [{ value: 'world-countries', label: 'World Countries' }]

// Mirrors the renderer's own `options.mapType ?? 'world-countries'`, so an
// unset option shows the geometry the map will actually draw rather than an
// empty select.
const DEFAULT_MAP_TYPE = 'world-countries'

// The property keys carried by every feature of world-countries.geojson (177
// features, these three keys and nothing else). buildChoroplethModel reads
// `feature.properties[targetField]`, so a value outside this list matches no
// region at all. These are properties of the geometry, not query columns, and
// they belong to the asset: a second map type would need its own list keyed
// by mapType.
const GEOMETRY_FIELDS = ['name', 'iso_a2', 'iso_a3']

export function ChoroplethEditor({ options: rawOptions, columns, onChange }: ChoroplethEditorProps) {
  const options = rawOptions as RedashChoroplethOptions

  const keyColumnId = useId()
  const targetFieldId = useId()
  const valueColumnId = useId()
  const mapTypeId = useId()

  const update = (key: keyof RedashChoroplethOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  return (
    <div className="space-y-4">
      {/* Key column and target field are the two halves of one join, so they
          sit next to each other: the row value first, then the geometry
          property it is matched against. */}
      <div>
        <Label htmlFor={keyColumnId} className="mb-1 block">Key Column</Label>
        <Select value={options.keyColumn || ''} onValueChange={(v) => update('keyColumn', v)}>
          <SelectTrigger id={keyColumnId} className="w-full h-8">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Select column...</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor={targetFieldId} className="mb-1 block">Matched Against (map property)</Label>
        <Select value={options.targetField || ''} onValueChange={(v) => update('targetField', v)}>
          <SelectTrigger id={targetFieldId} className="w-full h-8">
            <SelectValue placeholder="Select map property..." />
          </SelectTrigger>
          <SelectContent>
            {GEOMETRY_FIELDS.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.targetField ? (
          <p className="text-xs text-muted-foreground mt-1">A property of the map geometry, not a query column. The key column has to hold values in the same form, so <code>iso_a2</code> wants FJ and <code>name</code> wants Fiji.</p>
        ) : (
          // The one misconfiguration the renderer reports against the wrong
          // half of the join: with targetField unset the model matches
          // nothing, and the map says "No regions matched the key column"
          // while the key column may be perfectly fine.
          <p className="text-xs text-destructive mt-1">Required. Until a map property is picked, nothing can match and the map draws empty.</p>
        )}
      </div>
      <div>
        <Label htmlFor={valueColumnId} className="mb-1 block">Value Column</Label>
        <Select value={options.valueColumn || ''} onValueChange={(v) => update('valueColumn', v)}>
          <SelectTrigger id={valueColumnId} className="w-full h-8">
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Select column...</SelectItem>
            {columns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Numeric values shade each region. Rows whose value is empty or non-numeric stay unshaded.</p>
      </div>
      <div>
        <Label htmlFor={mapTypeId} className="mb-1 block">Map Type</Label>
        <Select
          value={options.mapType || DEFAULT_MAP_TYPE}
          onValueChange={(v) => update('mapType', v)}
        >
          <SelectTrigger id={mapTypeId} className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAP_TYPES.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
