import { instanceProfile } from './instance-profile'
import { dataSourceInventory } from './inventory'
import { cookieReader, type ContextReader } from './redash-get'
import { readyQueries } from './ready-queries'
import { clampTurnContext } from './turn-context'
import type { DataSourceEntry, InstanceProfile, ReadyQuery, TurnContext } from './turn-context'

export const CONTEXT_PART_TIMEOUT_MS = 4000

export interface ContextParts {
  instance: () => InstanceProfile
  dataSources: (reader: ContextReader, signal: AbortSignal) => Promise<DataSourceEntry[]>
  readyQueries: (reader: ContextReader, signal: AbortSignal) => Promise<ReadyQuery[]>
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
  timeoutMs: number = CONTEXT_PART_TIMEOUT_MS,
  reader: ContextReader = cookieReader(request.headers.get('cookie'))
): Promise<TurnContext> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
  const { instance, dataSources, readyQueries } = parts
  const [profile, sources, ready] = await Promise.all([
    attempt(instance),
    attempt(dataSources && (() => dataSources(reader, signal))),
    attempt(readyQueries && (() => readyQueries(reader, signal))),
  ])
  return clampTurnContext({
    ...(profile ? { instance: profile } : {}),
    ...(sources ? { dataSources: sources } : {}),
    ...(ready ? { readyQueries: ready } : {}),
  })
}
