import { z } from 'zod'
import { MAX_RESPONSE_BYTES, providerHeaders, readCappedStream } from '@/lib/ai-proxy'
import { USER_TOKEN_HEADER } from '@/lib/chat/relay'
import type { ChatToolResult, OpenToolResult } from '@/lib/chat/tool-results'
import type { InstanceProfile } from '@/lib/chat/turn-context'
import { config } from '@/lib/config'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { components } from '@/types/generated/veodyn-api'

type Schemas = components['schemas']

export type McpCallContext = Schemas['McpCallContextIn']

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.unknown()),
})

const toolsSchema = z.object({ tools: z.array(toolSchema) })

const doneSchema = z.object({
  kind: z.literal('done'),
  content: z.string(),
  isError: z.boolean(),
  draft: z
    .object({ draftId: z.string(), version: z.number(), threadId: z.string(), url: z.string() })
    .nullish(),
})

const clientCallSchema = z.object({
  kind: z.literal('client_call'),
  callId: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
})

const callSchema = z.discriminatedUnion('kind', [doneSchema, clientCallSchema])

export type RegistryTool = z.infer<typeof toolSchema>
export type RegistryDone = z.infer<typeof doneSchema>
export type RegistryClientCall = z.infer<typeof clientCallSchema>
export type RegistryOutcome = z.infer<typeof callSchema>

export class RegistryError extends Error {
  constructor(readonly status: number) {
    super(`The chat service refused the request (${status}).`)
  }
}

function endpoint(): string {
  const base = config.ai.endpoint
  if (!base) throw new AppError(ErrorIds.AI_CHAT_UNAVAILABLE, 'The chat service (ai.endpoint) is not configured')
  return `${base.replace(/\/+$/, '')}/chat/mcp`
}

async function post<T>(
  path: string,
  token: string,
  body: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`${endpoint()}${path}`, {
    method: 'POST',
    signal,
    headers: { ...providerHeaders(), [USER_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new RegistryError(response.status)
  if (response.body === null) throw new RegistryError(502)
  const parsed = schema.safeParse(JSON.parse(await readCappedStream(response.body, MAX_RESPONSE_BYTES)))
  if (!parsed.success) throw new RegistryError(502)
  return parsed.data
}

export async function listRegistryTools(
  token: string,
  instance: InstanceProfile | undefined,
  chatEnabled: boolean,
  signal?: AbortSignal
): Promise<RegistryTool[]> {
  const { tools } = await post('/tools', token, { ...(instance ? { instance } : {}), chatEnabled }, toolsSchema, signal)
  return tools
}

export function callRegistryTool(
  token: string,
  name: string,
  args: Record<string, unknown>,
  context: McpCallContext,
  signal?: AbortSignal
): Promise<RegistryOutcome> {
  return post('/calls', token, { name, arguments: args, context }, callSchema, signal)
}

export function postRegistryResult(
  token: string,
  callId: string,
  result: ChatToolResult | OpenToolResult,
  signal?: AbortSignal
): Promise<RegistryDone> {
  return post(`/calls/${encodeURIComponent(callId)}/result`, token, { result }, doneSchema, signal)
}
