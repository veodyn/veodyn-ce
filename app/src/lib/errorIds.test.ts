import { describe, expect, it } from 'vitest'
import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'

describe('AppError', () => {
  it('carries a stable id and context', () => {
    const error = new AppError(ErrorIds.UP_TIMEOUT, 'boom', { foo: 'bar' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AppError')
    expect(error.id).toBe(ErrorIds.UP_TIMEOUT)
    expect(error.message).toBe('boom')
    expect(error.context).toEqual({ foo: 'bar' })
    expect(error.toLogLine()).toBe('[E_UP_002] boom foo="bar"')
  })

  it('uses empty context by default and is recognized by the type guard', () => {
    const error = new AppError(ErrorIds.UP_TIMEOUT, 'timed out')

    expect(error.context).toEqual({})
    expect(error.toLogLine()).toBe('[E_UP_002] timed out')
    expect(isAppError(error)).toBe(true)
    expect(isAppError(new Error('timed out'))).toBe(false)
  })
})
