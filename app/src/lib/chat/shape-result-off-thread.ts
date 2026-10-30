import { abortError } from '@/lib/abortable-delay'
import type { QueryResultData } from '@/lib/mock-data'
import { shapeResult } from './shape-result'
import type { ChatQueryResult } from './tool-results'

export interface ShapeRequest {
  data: QueryResultData
  dataSourceId: number
}

function spawn(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./shape-result.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function shapeResultOffThread(
  data: QueryResultData,
  dataSourceId: number,
  signal: AbortSignal
): Promise<ChatQueryResult> {
  if (signal.aborted) return Promise.reject(abortError())
  const worker = spawn()
  if (!worker) return Promise.resolve(shapeResult(data, dataSourceId))
  return new Promise<ChatQueryResult>((resolve, reject) => {
    const finish = () => {
      worker.terminate()
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      finish()
      reject(abortError())
    }
    const onMainThread = () => {
      finish()
      try {
        resolve(shapeResult(data, dataSourceId))
      } catch (error) {
        reject(error)
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', (event: MessageEvent<ChatQueryResult>) => {
      finish()
      resolve(event.data)
    })
    worker.addEventListener('error', onMainThread)
    worker.addEventListener('messageerror', onMainThread)
    try {
      worker.postMessage({ data, dataSourceId } satisfies ShapeRequest)
    } catch {
      onMainThread()
    }
  })
}
