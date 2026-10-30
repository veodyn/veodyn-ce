import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultData } from '@/lib/mock-data'
import { shapeResult } from './shape-result'
import { shapeResultOffThread, type ShapeRequest } from './shape-result-off-thread'

const DATA: QueryResultData = {
  columns: [
    { name: 'route', type: 'string', friendly_name: 'route' },
    { name: 'riders', type: 'integer', friendly_name: 'riders' },
  ],
  rows: [
    { route: 'A', riders: 10 },
    { route: 'B', riders: null },
    { route: 'A', riders: 4 },
  ],
}

type Listener = (event: { data?: unknown }) => void

class FakeWorker {
  static instances: FakeWorker[] = []
  readonly listeners = new Map<string, Listener>()
  readonly posted: unknown[] = []
  terminated = false

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions
  ) {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener)
  }

  postMessage(message: unknown) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(type: string, data?: unknown) {
    this.listeners.get(type)?.({ data })
  }
}

function withFakeWorker(): () => FakeWorker {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  return () => FakeWorker.instances[0]
}

afterEach(() => vi.unstubAllGlobals())

describe('shapeResultOffThread', () => {
  it('shapes_on_the_calling_thread_when_workers_are_unavailable', async () => {
    expect(typeof Worker).toBe('undefined')
    await expect(shapeResultOffThread(DATA, 5, new AbortController().signal)).resolves.toEqual(shapeResult(DATA, 5))
  })

  it('hands_the_rows_to_a_module_worker_and_resolves_with_its_answer', async () => {
    const worker = withFakeWorker()
    const pending = shapeResultOffThread(DATA, 5, new AbortController().signal)
    expect(worker().options).toEqual({ type: 'module' })
    expect(worker().url.pathname).toMatch(/shape-result\.worker\.ts$/)
    expect(worker().posted).toEqual([{ data: DATA, dataSourceId: 5 } satisfies ShapeRequest])
    const answer = shapeResult(DATA, 5)
    worker().emit('message', answer)
    await expect(pending).resolves.toEqual(answer)
    expect(worker().terminated).toBe(true)
  })

  it('an_abort_terminates_the_worker_and_rejects_as_aborted', async () => {
    const worker = withFakeWorker()
    const controller = new AbortController()
    const pending = shapeResultOffThread(DATA, 5, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker().terminated).toBe(true)
  })

  it('an_already_aborted_signal_starts_no_worker', async () => {
    withFakeWorker()
    const controller = new AbortController()
    controller.abort()
    await expect(shapeResultOffThread(DATA, 5, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('a_worker_that_fails_to_load_falls_back_to_the_same_shape', async () => {
    const worker = withFakeWorker()
    const pending = shapeResultOffThread(DATA, 5, new AbortController().signal)
    worker().emit('error')
    await expect(pending).resolves.toEqual(shapeResult(DATA, 5))
    expect(worker().terminated).toBe(true)
  })
})

describe('the shaping worker script', () => {
  it('answers_a_request_with_exactly_what_shapeResult_returns', async () => {
    let handler: ((event: MessageEvent<ShapeRequest>) => void) | undefined
    const postMessage = vi.fn()
    vi.stubGlobal('addEventListener', (type: string, listener: (event: MessageEvent<ShapeRequest>) => void) => {
      if (type === 'message') handler = listener
    })
    vi.stubGlobal('postMessage', postMessage)
    await import('./shape-result.worker')
    handler?.({ data: { data: DATA, dataSourceId: 5 } } as MessageEvent<ShapeRequest>)
    expect(postMessage).toHaveBeenCalledWith(shapeResult(DATA, 5))
  })
})
