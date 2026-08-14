// The closed set the mapping editor offers, mirroring REQUIRED_FIELDS and
// SUPPORTED_FIELDS in api/veodyn_api/services/gtfs_rt_serializer.py.
//
// Hand-written because nothing carries it on the wire: columnMap is a bare
// string map. api/tests/gtfs_field_vocabulary.json is the ratchet that fails
// the API suite if the serializer changes without this file changing with it.
//
// Required first, then optional, both in the order a person reading a vehicle
// position would expect rather than alphabetically.
export interface GtfsField {
  name: string
  required: boolean
}

export const GTFS_FIELDS: GtfsField[] = [
  { name: 'vehicle_id', required: true },
  { name: 'latitude', required: true },
  { name: 'longitude', required: true },
  { name: 'trip_id', required: false },
  { name: 'route_id', required: false },
  { name: 'bearing', required: false },
  { name: 'speed', required: false },
  { name: 'timestamp', required: false },
]

export const REQUIRED_GTFS_FIELDS = GTFS_FIELDS.filter((field) => field.required).map((f) => f.name)

/** What the create/edit form sends: mapped fields only, unmapped ones absent. */
export function toColumnMap(selection: Record<string, string | null>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const field of GTFS_FIELDS) {
    const column = selection[field.name]
    if (column) map[field.name] = column
  }
  return map
}

/** The problems the form can catch before it posts. */
export function missingRequired(selection: Record<string, string | null>): string[] {
  return REQUIRED_GTFS_FIELDS.filter((name) => !selection[name])
}
