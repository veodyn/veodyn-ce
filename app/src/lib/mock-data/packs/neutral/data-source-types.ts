import type { MockDataSourceType } from '../types/data-source-types'
import { connectorDataSourceTypes } from './data-source-types.connectors'

export const mockDataSourceTypes: MockDataSourceType[] = [
  {
    type: 'pg',
    name: 'PostgreSQL',
    configuration_schema: {
      type: 'object',
      properties: {
        host: { type: 'string', title: 'Host' },
        port: { type: 'number', title: 'Port', default: 5432 },
        user: { type: 'string', title: 'User' },
        password: { type: 'string', title: 'Password' },
        dbname: { type: 'string', title: 'Database Name' },
        sslmode: { type: 'string', title: 'SSL Mode', default: 'prefer' },
      },
      order: ['host', 'port', 'user', 'password', 'dbname', 'sslmode'],
      required: ['host', 'dbname', 'user'],
      secret: ['password'],
    },
  },
  {
    type: 'mysql',
    name: 'MySQL',
    configuration_schema: {
      type: 'object',
      properties: {
        host: { type: 'string', title: 'Host' },
        port: { type: 'number', title: 'Port', default: 3306 },
        user: { type: 'string', title: 'User' },
        password: { type: 'string', title: 'Password' },
        db: { type: 'string', title: 'Database Name' },
      },
      order: ['host', 'port', 'user', 'password', 'db'],
      required: ['host', 'db', 'user'],
      secret: ['password'],
    },
  },
  {
    type: 'sqlite',
    name: 'SQLite',
    configuration_schema: {
      type: 'object',
      properties: {
        dbpath: { type: 'string', title: 'Database Path' },
      },
      order: ['dbpath'],
      required: ['dbpath'],
      secret: [],
    },
  },
  {
    type: 'json',
    name: 'JSON',
    configuration_schema: {
      type: 'object',
      properties: {
        base_url: { type: 'string', title: 'Base URL' },
        username: { type: 'string', title: 'HTTP Basic Auth Username' },
        password: { type: 'string', title: 'HTTP Basic Auth Password' },
      },
      order: ['base_url', 'username', 'password'],
      required: [],
      secret: ['password'],
    },
  },
  {
    type: 'google_spreadsheets',
    name: 'Google Sheets',
    configuration_schema: {
      type: 'object',
      properties: {
        jsonKeyFile: { type: 'string', title: 'JSON Key File' },
      },
      order: ['jsonKeyFile'],
      required: ['jsonKeyFile'],
      secret: ['jsonKeyFile'],
    },
  },
  {
    type: 'bigquery',
    name: 'Google BigQuery',
    configuration_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', title: 'Project ID' },
        jsonKeyFile: { type: 'string', title: 'JSON Key File' },
        totalMBytesProcessedLimit: { type: 'number', title: 'Scanned Data Limit (MB)', default: null },
        loadSchema: { type: 'boolean', title: 'Load Schema', default: true },
      },
      order: ['projectId', 'jsonKeyFile', 'totalMBytesProcessedLimit', 'loadSchema'],
      required: ['projectId', 'jsonKeyFile'],
      secret: ['jsonKeyFile'],
    },
  },
  {
    type: 'redshift',
    name: 'Amazon Redshift',
    configuration_schema: {
      type: 'object',
      properties: {
        host: { type: 'string', title: 'Host' },
        port: { type: 'number', title: 'Port', default: 5439 },
        user: { type: 'string', title: 'User' },
        password: { type: 'string', title: 'Password' },
        dbname: { type: 'string', title: 'Database Name' },
      },
      order: ['host', 'port', 'user', 'password', 'dbname'],
      required: ['host', 'dbname', 'user'],
      secret: ['password'],
    },
  },
  {
    type: 'clickhouse',
    name: 'ClickHouse',
    configuration_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', title: 'URL', default: 'http://localhost:8123' },
        user: { type: 'string', title: 'User', default: 'default' },
        password: { type: 'string', title: 'Password' },
        dbname: { type: 'string', title: 'Database Name', default: 'default' },
      },
      order: ['url', 'user', 'password', 'dbname'],
      required: ['url'],
      secret: ['password'],
    },
  },
  {
    type: 'mongodb',
    name: 'MongoDB',
    configuration_schema: {
      type: 'object',
      properties: {
        connectionString: { type: 'string', title: 'Connection String' },
        dbName: { type: 'string', title: 'Database Name' },
      },
      order: ['connectionString', 'dbName'],
      required: ['connectionString', 'dbName'],
      secret: [],
    },
  },
  {
    type: 'prometheus',
    name: 'Prometheus',
    configuration_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', title: 'URL' },
      },
      order: ['url'],
      required: ['url'],
      secret: [],
    },
  },
  // Kept last, where ntcip_dms was before the split, so the order this
  // fixture hands the type list to a form does not change.
  ...connectorDataSourceTypes,
]
