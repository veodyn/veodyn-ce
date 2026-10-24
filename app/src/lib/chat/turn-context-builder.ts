import { instanceProfile } from './instance-profile'
import { dataSourceInventory } from './inventory'
import { readyQueries } from './ready-queries'
import { clampTurnContext } from './turn-context'
import type { DataSourceEntry, InstanceProfile, ReadyQuery, TurnContext } from './turn-context'

export const CONTEXT_PART_TIMEOUT_MS = 4000

export interface ContextParts {
  instance: () => InstanceProfile
  dataSources: (cookie: string | null, signal: AbortSignal) => Promise<DataSourceEntry[]>
  readyQueries: (cookie: string | null, signal: AbortSignal) => Promise<ReadyQuery[]>
}

const DEFAULT_PARTS: Partial<ContextParts> = {
  instance: instanceProfile,
  dataSources: dataSourceInventory,
  readyQueries,
}

async function attempt<T>(run: (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  if (!run) return undefined
  try {
    return await run()
  } catch {
    return undefined
  }
}

export async function buildTurnContext(
  request: Request,
  parts: Partial<ContextParts> = DEFAULT_PARTS,
  timeoutMs: number = CONTEXT_PART_TIMEOUT_MS
): Promise<TurnContext> {
  const cookie = request.headers.get('cookie')
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
  const { instance, dataSources, readyQueries } = parts
  const [profile, sources, ready] = await Promise.all([
    attempt(instance),
    attempt(dataSources && (() => dataSources(cookie, signal))),
    attempt(readyQueries && (() => readyQueries(cookie, signal))),
  ])
  return clampTurnContext({
    ...(profile ? { instance: profile } : {}),
    ...(sources ? { dataSources: sources } : {}),
    ...(ready ? { readyQueries: ready } : {}),
  })
}
