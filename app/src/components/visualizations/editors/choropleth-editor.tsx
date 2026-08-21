'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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

  const boundarySourceId = useId()
  const mapSourceId = useId()
  const columnSourceId = useId()
  const keyColumnId = useId()
  const targetFieldId = useId()
  const valueColumnId = useId()
  const mapTypeId = useId()
  const geometryColumnId = useId()

  // Absent means the bundled map, matching the renderer, so a saved choropleth
  // shows the source it is actually drawing from.
  const fromColumn = options.boundarySource === 'column'

  const update = (key: keyof RedashChoroplethOptions, value: unknown) => {
    onChange({ ...rawOptions, [key]: value })
  }

  // Going back to the bundled map drops geometryColumn rather than leaving it
  // set: map mode never reads it, and a stale name would be reported against a
  // map that is drawing correctly. mapType and targetField survive the trip the
  // other way, neither of them naming a result column.
  const setBoundarySource = (value: string) => {
    if (value === 'column') {
      onChange({ ...rawOptions, boundarySource: 'column' })
      return
    }
    const next: Record<string, unknown> = { ...rawOptions, boundarySource: 'map' }
    delete next.geometryColumn
    onChange(next)
  }

  return (
    <div className="space-y-4">
      <div>
        <Label id={boundarySourceId} className="mb-1 block">Region Boundaries</Label>
        <RadioGroup
          aria-labelledby={boundarySourceId}
          value={fromColumn ? 'column' : 'map'}
          onValueChange={(v) => v && setBoundarySource(v)}
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="map" id={mapSourceId} className="mt-0.5" />
            <Label htmlFor={mapSourceId} className="font-normal">
              Bundled map: shade the regions of a map this app ships.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="column" id={columnSourceId} className="mt-0.5" />
            <Label htmlFor={columnSourceId} className="font-normal">
              Geometry column: one region per result row, drawn from the query itself.
            </Label>
          </div>
        </RadioGroup>
      </div>
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
        {fromColumn ? (
          <p className="text-xs text-muted-foreground mt-1">Names each region. There is nothing to match against here: every row is its own region.</p>
        ) : null}
      </div>
      {fromColumn ? null : (
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
      )}
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
      {fromColumn ? (
        <div>
          <Label htmlFor={geometryColumnId} className="mb-1 block">Geometry Column (GeoJSON)</Label>
          <Select value={options.geometryColumn || ''} onValueChange={(v) => update('geometryColumn', v)}>
            <SelectTrigger id={geometryColumnId} className="w-full h-8">
              <SelectValue placeholder="Select column..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Select column...</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {options.geometryColumn ? (
            <p className="text-xs text-muted-foreground mt-1">Each cell holds one region as GeoJSON, either a bare geometry or a whole Feature. Rows the app cannot read are left out of the map.</p>
          ) : (
            <p className="text-xs text-destructive mt-1">Required. The boundaries live in this column, so until one is picked nothing can be drawn.</p>
          )}
        </div>
      ) : (
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
      )}
    </div>
  )
}
