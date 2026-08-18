// The transport/ITS connector family, split out of data-source-types.ts.
//
// These entries mirror runners built on the fork's `connector_base`
// (node/redash/query_runner/connector_base.py), descriptions included, because
// the data-source form renders those as help text. connector_base appends four
// more fields to every runner in the family after whatever the runner declares;
// they live once in COMMON_CONNECTOR_FIELDS and are spread into each entry.

import type { ConfigSchemaProperty, MockDataSourceType } from '../types/data-source-types'

// connector_base.build_configuration_schema, verbatim and in the order the real
// schema appends them. Each `order` array below ends with the same four names.
const COMMON_CONNECTOR_FIELDS: Record<string, ConfigSchemaProperty> = {
  request_timeout: { type: 'number', title: 'Request Timeout (seconds)', default: 30 },
  redis_url: { type: 'string', title: 'Redis URL for PubSub (optional)', default: '' },
  enable_historical_capture: {
    type: 'boolean',
    title: 'Historical capture (scheduled runs → warehouse)',
    default: false,
  },
  historical_retention_days: {
    type: 'number',
    title: 'Historical retention (days, 0 = keep forever)',
    default: 0,
  },
}

export const COMMON_CONNECTOR_FIELD_NAMES = Object.keys(COMMON_CONNECTOR_FIELDS)

export const connectorDataSourceTypes: MockDataSourceType[] = [
  {
    type: 'ntcip_dms',
    name: 'NTCIP 1203 DMS',
    configuration_schema: {
      type: 'object',
      properties: {
        community: {
          type: 'string',
          title: 'SNMP Community String',
          description:
            'The SNMP community string used to authenticate to each sign. SNMP v1 and v2c ' +
            'send this in plain text on the wire, with no encryption, so anyone able to ' +
            'observe the network path to a device can read it. Only use this connector on ' +
            'a network isolated from untrusted traffic (a private VLAN or a VPN), never ' +
            'across the open internet.',
        },
        snmp_version: {
          type: 'string',
          title: 'SNMP Version',
          default: '2c',
        },
        default_devices: {
          type: 'string',
          title: 'Devices (JSON)',
          description:
            'A JSON list of the signs to poll, one object per device: ' +
            '[{"name": "I-5 NB MP12", "host": "10.0.1.20", "port": 161}]. "port" defaults ' +
            'to 161 when omitted.',
        },
        per_device_timeout: { type: 'number', title: 'Per-Device Timeout (seconds)', default: 2 },
        max_devices: { type: 'number', title: 'Max Devices Polled', default: 50 },
        ...COMMON_CONNECTOR_FIELDS,
      },
      order: [
        'community',
        'snmp_version',
        'default_devices',
        'per_device_timeout',
        'max_devices',
        ...COMMON_CONNECTOR_FIELD_NAMES,
      ],
      required: ['community', 'default_devices'],
      secret: ['community'],
    },
  },
  {
    // Mirrors TMDD.configuration_schema() in
    // node/redash/query_runner/tmdd_config.py, plus the four common fields.
    // The real schema's `enum` and `minLength`/`maxLength` facets are omitted:
    // nothing in schema-fields.ts reads them. The property SET is what must
    // match, and neutral.test.ts asserts it literally.
    type: 'tmdd',
    name: 'TMDD Center-to-Center',
    configuration_schema: {
      type: 'object',
      properties: {
        endpoint_url: {
          type: 'string',
          title: 'C2C SOAP Endpoint URL',
          description:
            "The center's TMDD Center-to-Center SOAP endpoint. This connector only ever " +
            'sends request messages, never a control or command operation.',
        },
        username: {
          type: 'string',
          title: 'User ID',
          description:
            'Sent as authentication/user-id, 1 to 32 characters. The authentication block ' +
            'is optional, but both of its children are mandatory once it is present, so a ' +
            'user ID and a password must be given together or both left empty.',
        },
        password: {
          type: 'string',
          title: 'Password',
          description:
            'Sent as authentication/password, 1 to 256 characters. The v3.03d bundle ' +
            'defines Security-password in two files with different limits; the ' +
            'authentication block is declared in TMDD.xsd and references it unprefixed, ' +
            "so TMDD.xsd's limit of 256 is the one the schema enforces.",
        },
        organization_id: {
          type: 'string',
          title: 'Organization ID',
          description:
            "This system's organization identifier, 1 to 32 characters. Sent in every " +
            'request so the center can attribute it.',
        },
        tmdd_version: {
          type: 'string',
          title: 'TMDD Version',
          default: '3.03d',
          description:
            'Only v3.03d is implemented. Anything else is refused at query time rather ' +
            'than sent and hoped for.',
        },
        soap_action: {
          type: 'string',
          title: 'SOAPAction Header Value',
          default: '',
          description:
            'Left empty, the SOAPAction header is sent as "". The v3.03d WSDL declares the ' +
            'same raw value for all 80 operations, and that value is two apostrophe ' +
            "characters rather than an empty string. Read as an authoring artifact it " +
            "means empty; read literally it means the action URI is ''. The bundle cannot " +
            "settle it, so a center that wants the literal can be given '' here without a " +
            'code change.',
        },
        message_type_id: {
          type: 'number',
          title: 'Message Type ID',
          default: 1,
          description:
            'Mandatory in an event request header. The v3.03d bundle does not define what ' +
            'any particular value means, so the default is sent unless a center documents ' +
            'one of its own.',
        },
        message_type_version: {
          type: 'number',
          title: 'Message Type Version',
          default: 1,
          description:
            'Mandatory in an event request header. As with the message type ID, the bundle ' +
            'does not define its values.',
        },
        verify_tls: { type: 'boolean', title: 'Verify TLS Certificate', default: true },
        ca_bundle: {
          type: 'string',
          title: 'CA Bundle Path (optional)',
          description:
            "Path to a PEM bundle used to verify the center's certificate. Agency centers " +
            'commonly run a private CA, which is worth trusting explicitly rather than ' +
            'turning verification off.',
        },
        max_response_mb: {
          type: 'number',
          title: 'Max Response Size (MB)',
          default: 10,
          description: 'Enforced while the body streams in, before it is parsed.',
        },
        max_records: {
          type: 'number',
          title: 'Max Records',
          default: 10000,
          description:
            'A cap on the decoded record count. Exceeding it is an error, not a ' +
            'truncation, so a partial answer is never mistaken for the whole one. The ' +
            'limit param is the opposite: it truncates on purpose.',
        },
        ...COMMON_CONNECTOR_FIELDS,
      },
      order: [
        'endpoint_url',
        'username',
        'password',
        'organization_id',
        'tmdd_version',
        'soap_action',
        'message_type_id',
        'message_type_version',
        'verify_tls',
        'ca_bundle',
        'max_response_mb',
        'max_records',
        ...COMMON_CONNECTOR_FIELD_NAMES,
      ],
      required: ['endpoint_url', 'organization_id'],
      secret: ['password'],
    },
  },
]
