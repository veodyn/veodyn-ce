import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCreateFromProposal } from './use-create-from-proposal'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const onCreated = vi.fn()
  const onBusyChange = vi.fn()
  const view = renderHook(() => useCreateFromProposal({ onCreated, onBusyChange }))
  return { ...view, onCreated, onBusyChange }
}

describe('useCreateFromProposal', () => {
  it('reports busy for exactly as long as the commit runs', async () => {
    const gate = deferred<string | null>()
    const { result, onCreated, onBusyChange } = setup()

    act(() => result.current.start(() => gate.promise))
    expect(result.current.busy).toBe(true)
    expect(onBusyChange).toHaveBeenCalledWith(true)
    expect(onCreated).not.toHaveBeenCalled()

    await act(async () => {
      gate.resolve('/queries/7')
      await gate.promise
    })

    expect(result.current.busy).toBe(false)
    expect(onCreated).toHaveBeenCalledWith('/queries/7')
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })

  it('ignores a second press while the first create is still in flight', async () => {
    const gate = deferred<string | null>()
    const commit = vi.fn(() => gate.promise)
    const { result } = setup()

    act(() => result.current.start(commit))
    act(() => result.current.start(commit))

    // The object would already have been written by the time the second press
    // landed, so a second run would create it twice.
    expect(commit).toHaveBeenCalledTimes(1)

    await act(async () => {
      gate.resolve(null)
      await gate.promise
    })
    expect(result.current.busy).toBe(false)
  })

  it('keeps the rejection and releases the shell, without reporting a create', async () => {
    const failure = new Error('Backend said 503')
    const { result, onCreated, onBusyChange } = setup()

    await act(async () => {
      result.current.start(() => Promise.reject(failure))
    })

    await waitFor(() => expect(result.current.error).toBe(failure))
    expect(result.current.busy).toBe(false)
    expect(onCreated).not.toHaveBeenCalled()
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })

  it('clears the previous error when a retry starts', async () => {
    const { result } = setup()

    await act(async () => {
      result.current.start(() => Promise.reject(new Error('first')))
    })
    await waitFor(() => expect(result.current.error).not.toBeNull())

    const gate = deferred<string | null>()
    act(() => result.current.start(() => gate.promise))
    expect(result.current.error).toBeNull()

    await act(async () => {
      gate.resolve(null)
      await gate.promise
    })
  })
})
