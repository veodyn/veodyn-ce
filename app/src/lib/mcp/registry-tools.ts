import type { RegistryTool } from './registry-client'
import { LEGACY_TOOL_NAMES, MCP_TOOLS, type McpToolSchema } from './tool-schemas'

export interface ListedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const RUN_QUERY = 'run_query'
const LEGACY_RUN_QUERY_NOTE =
  'Legacy form: pass query_id to run a saved query and read its cached rows, with max_age setting how stale the result may be. Prefer run_saved_query.'

function legacyTools(): ListedTool[] {
  return MCP_TOOLS.filter((tool) => LEGACY_TOOL_NAMES.has(tool.name))
}

function legacyRunQuery(): McpToolSchema {
  const tool = MCP_TOOLS.find((one) => one.name === RUN_QUERY)
  if (!tool) throw new Error('The legacy run_query schema is missing.')
  return tool
}

function mergedRunQuery(registry: RegistryTool): ListedTool {
  const legacy = legacyRunQuery()
  const properties = (registry.inputSchema.properties ?? {}) as Record<string, unknown>
  return {
    name: RUN_QUERY,
    description: `${registry.description}\n\n${LEGACY_RUN_QUERY_NOTE}`,
    inputSchema: {
      ...registry.inputSchema,
      type: 'object',
      properties: {
        ...properties,
        query_id: legacy.inputSchema.properties.query_id,
        parameters: legacy.inputSchema.properties.parameters,
        max_age: legacy.inputSchema.properties.max_age,
      },
      required: [],
    },
  }
}

export function mergedToolList(registry: RegistryTool[]): ListedTool[] {
  const listed = registry
    .filter((tool) => !LEGACY_TOOL_NAMES.has(tool.name))
    .map((tool) => (tool.name === RUN_QUERY ? mergedRunQuery(tool) : tool))
  const withRunQuery = listed.some((tool) => tool.name === RUN_QUERY) ? listed : [...listed, legacyRunQuery()]
  return [...withRunQuery, ...legacyTools()]
}

export function legacyOnlyToolList(): ListedTool[] {
  return MCP_TOOLS
}
