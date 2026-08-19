// The GBFS stations vocabulary, mirroring REQUIRED_FIELDS / SUPPORTED_FIELDS in
// api/veodyn_api/services/gbfs_serializer.py; api/tests/gbfs_field_vocabulary.json
// is the ratchet that fails the API suite if the two drift.
//
// Version-neutral on purpose: the serializer decides that 2.3 spells the count
// `num_bikes_available` and 3.0 spells it `num_vehicles_available`, so a person
// mapping columns never has to know which they are on.
import { GTFS_FIELDS, type GtfsField } from '@/lib/gtfs-fields'
import type { FeedStandard } from '@/types/published-feed'

// The join key first, then what identifies a station, then what changes minute
// to minute, which is the order somebody reading a station feed expects.
export const GBFS_STATION_FIELDS: GtfsField[] = [
  { name: 'station_id', required: true },
  { name: 'name', required: true },
  { name: 'lat', required: true },
  { name: 'lon', required: true },
  { name: 'num_vehicles_available', required: true },
  { name: 'is_installed', required: true },
  { name: 'is_renting', required: true },
  { name: 'is_returning', required: true },
  { name: 'last_reported', required: true },
  { name: 'num_docks_available', required: false },
  { name: 'capacity', required: false },
  { name: 'address', required: false },
]

/**
 * What the System section asks for, per version, in render order. These are the
 * INPUT keys the binding stores: 3.0 takes one `language` here and the
 * serializer writes it out as the `languages` array that version requires.
 */
export const SYSTEM_INFO_FIELDS: Record<string, string[]> = {
  '2.3': ['system_id', 'language', 'name', 'timezone'],
  '3.0': ['system_id', 'language', 'name', 'timezone', 'opening_hours', 'feed_contact_email'],
}

export function fieldsFor(standard: FeedStandard): GtfsField[] {
  return standard === 'gbfs' ? GBFS_STATION_FIELDS : GTFS_FIELDS
}

/** The system fields a version requires, defaulting to the narrower 2.3 set. */
export function systemFieldsFor(version: string): string[] {
  return SYSTEM_INFO_FIELDS[version] ?? SYSTEM_INFO_FIELDS['2.3']
}
