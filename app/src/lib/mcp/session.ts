import type { ContextReader } from '@/lib/chat/redash-get'
import type { SidecarTransport } from '@/lib/chat/sidecar-transport'
import type { RedashTransport } from '@/lib/chat/transport'
import { config } from '@/lib/config'
import { publicOrigin } from '@/lib/public-origin'
import { verifyCaller, mcpSubjectToken } from './identity'
import type { McpCredential } from './redash-caller'
import { credentialReader, serverTransport } from './server-transport'
import { mcpSidecarTransport } from './sidecar-transport'

export interface McpIdentity {
  userId: number
  token: string
  transport: RedashTransport
  sidecar: SidecarTransport
  reader: ContextReader
}

export interface McpSession {
  request: Request
  origin: string
  chatEnabled: boolean
  identity: () => Promise<McpIdentity | null>
}

export function createMcpSession(credential: McpCredential, request: Request): McpSession {
  let pending: Promise<McpIdentity | null> | null = null

  async function resolve(): Promise<McpIdentity | null> {
    const caller = await verifyCaller(credential, request.signal)
    if (!caller) return null
    const token = mcpSubjectToken(caller.userId)
    return {
      userId: caller.userId,
      token,
      transport: serverTransport(credential),
      sidecar: mcpSidecarTransport(credential, token),
      reader: credentialReader(credential, `mcp:${caller.userId}`),
    }
  }

  return {
    request,
    origin: publicOrigin(request),
    chatEnabled: config.ai.enabled,
    identity: () => (pending ??= resolve()),
  }
}
