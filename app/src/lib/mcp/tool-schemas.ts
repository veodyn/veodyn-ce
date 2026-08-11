// What this server offers an assistant client.
//
// Read-only, deliberately. An MCP client acts on a model's judgement, and the
// blast radius of a mistaken write against a shared analytics instance is not
// worth the convenience. Creating and editing stay in the app, where a person
// is looking at the screen.

export interface McpToolSchema {
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const PAGE_SIZE = {
  type: 'number',
  description: 'How many rows to return. Defaults to 25, capped at 100.',
} as const

export const MCP_TOOLS: McpToolSchema[] = [
  {
    name: 'list_queries',
    title: 'List queries',
    description:
      'List the saved queries this instance holds, newest first. Use the search argument to narrow by name. Returns id, name, description and schedule for each.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Substring to match against the query name.' },
        page_size: PAGE_SIZE,
      },
    },
  },
  {
    name: 'get_query',
    title: 'Get a query',
    description:
      'Read one saved query in full, including its SQL and any parameters it declares. Call this before run_query when you need to know what parameters to pass.',
    inputSchema: {
      type: 'object',
      properties: {
        query_id: { type: 'number', description: 'Numeric id of the query.' },
      },
      required: ['query_id'],
    },
  },
  {
    name: 'run_query',
    title: 'Run a query',
    description:
      "Execute a saved query and return its rows. Runs as the credential you authenticated with, so it can only reach data that identity may read. Prefer leaving max_age unset: the instance's cached result is usually what you want and costs the warehouse nothing.",
    inputSchema: {
      type: 'object',
      properties: {
        query_id: { type: 'number', description: 'Numeric id of the query to run.' },
        parameters: {
          type: 'object',
          description: 'Values for the query parameters, keyed by parameter name.',
        },
        max_age: {
          type: 'number',
          description:
            'Seconds a cached result may be reused for. 0 forces a fresh execution. Omit to accept whatever the instance has cached.',
        },
      },
      required: ['query_id'],
    },
  },
  {
    name: 'list_dashboards',
    title: 'List dashboards',
    description:
      'List the dashboards this instance holds. Returns id, name and slug for each, so a dashboard can then be read with get_dashboard. Prefer passing the id back to get_dashboard: a slug costs an extra lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Case-insensitive substring to match against the dashboard name.',
        },
        page_size: PAGE_SIZE,
      },
    },
  },
  {
    name: 'get_dashboard',
    title: 'Get a dashboard',
    description:
      'Read one dashboard: its widgets, and for each widget the query behind it. Use this to find which queries answer a question, then run them.',
    inputSchema: {
      type: 'object',
      properties: {
        dashboard: {
          type: 'string',
          description:
            'The dashboard id or slug, as returned by list_dashboards. An id is one request; a slug costs a lookup first.',
        },
      },
      required: ['dashboard'],
    },
  },
]

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export function clampPageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)))
}
