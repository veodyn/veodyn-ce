// The mapping every data source and destination form runs on. It used to live
// inline in four pages, and none of the four mapped `boolean`: the regional
// runners' "Historical capture" toggle rendered as a text box you had to type
// into, and the string it saved was truthy on the server whatever you typed.
import { describe, expect, it } from 'vitest'
import { schemaFields } from './schema-fields'

const SCHEMA = {
  properties: {
    api_base_url: { type: 'string', title: 'Regional API Base URL' },
    api_key: { type: 'string', title: 'Regional API Key (optional)' },
    request_timeout: { type: 'number', title: 'Request Timeout (seconds)', default: 30 },
    enable_historical_capture: { type: 'boolean', title: 'Historical capture', default: false },
    historical_retention_days: { type: 'number', title: 'Historical retention', default: 0 },
  },
  required: ['api_base_url'],
  secret: ['api_key'],
}

describe('schemaFields', () => {
  it('maps a boolean option to a checkbox field, not a text input', () => {
    const capture = schemaFields(SCHEMA).find((f) => f.name === 'enable_historical_capture')
    expect(capture).toMatchObject({ type: 'boolean', title: 'Historical capture', default: false })
  })

  it('keeps numbers numeric and secrets hidden', () => {
    const byName = Object.fromEntries(schemaFields(SCHEMA).map((f) => [f.name, f]))

    expect(byName.request_timeout).toMatchObject({ type: 'number', default: 30 })
    expect(byName.historical_retention_days.type).toBe('number')
    expect(byName.api_key.type).toBe('password')
    expect(byName.api_base_url).toMatchObject({ type: 'string', required: true })
    expect(byName.request_timeout.required).toBe(false)
  })

  it('treats a secret as a password whatever the schema calls it', () => {
    const [field] = schemaFields({
      properties: { token: { type: 'boolean', title: 'Token' } },
      secret: ['token'],
    })

    expect(field.type).toBe('password')
  })

  it('follows the schema order, leaving unlisted fields after the listed ones', () => {
    const names = schemaFields({ ...SCHEMA, order: ['request_timeout', 'api_base_url'] }).map(
      (f) => f.name
    )

    expect(names.slice(0, 2)).toEqual(['request_timeout', 'api_base_url'])
    expect(names).toHaveLength(5)
  })

  it('survives a schema with no properties, required or secret list', () => {
    expect(schemaFields(undefined)).toEqual([])
    expect(schemaFields({})).toEqual([])
    expect(schemaFields({ properties: { host: { type: 'string' } } })).toEqual([
      { name: 'host', title: 'host', type: 'string', default: undefined, required: false },
    ])
  })

  // Task 2's ntcip_dms schema puts a cleartext-community-string warning in a
  // field's description. Before this, schemaFields dropped description
  // entirely, so DynamicForm had nothing to render even after it learned how.
  it("carries a field's description straight through from the schema", () => {
    const [field] = schemaFields({
      properties: {
        community: { type: 'string', title: 'SNMP Community String', description: 'Sent in cleartext.' },
      },
    })

    expect(field.description).toBe('Sent in cleartext.')
  })

  it('leaves description undefined when the schema has none', () => {
    const [field] = schemaFields({ properties: { host: { type: 'string', title: 'Host' } } })

    expect(field.description).toBeUndefined()
  })

  // default_devices is a JSON document held in a schema string field (JSON
  // Schema has no tighter type for "this string is JSON"), and the schema
  // names that in its title the same way gtfs_realtime's route_labels field
  // already does. Reading that convention is what lets a JSON-shaped field
  // render as a validating textarea instead of a single-line input a real
  // device list could never fit in.
  it('detects a JSON-shaped string field from its title and types it json, not string', () => {
    const [field] = schemaFields({
      properties: { default_devices: { type: 'string', title: 'Devices (JSON)' } },
    })

    expect(field.type).toBe('json')
  })

  it('does not mistype an ordinary string field as json', () => {
    const [field] = schemaFields({
      properties: { host: { type: 'string', title: 'Host' } },
    })

    expect(field.type).toBe('string')
  })

  it('a secret still wins over a json-shaped title', () => {
    const [field] = schemaFields({
      properties: { blob: { type: 'string', title: 'Secret Blob (JSON)' } },
      secret: ['blob'],
    })

    expect(field.type).toBe('password')
  })
})
