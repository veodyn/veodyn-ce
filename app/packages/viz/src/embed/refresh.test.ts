import { describe, expect, it } from 'vitest'
import { clampRefreshSeconds, refreshIntervalMs } from './refresh'

describe('clampRefreshSeconds', () => {
  it.each([
    [undefined, null],
    [null, null],
    [0, null],
    [-5, null],
    [Number.NaN, null],
    [1, 15],
    [15, 15],
    [60.4, 60],
    [7200, 3600],
  ])('turns %s into %s', (input, expected) => {
    expect(clampRefreshSeconds(input as number | null | undefined)).toBe(expected)
  })
})

describe('refreshIntervalMs', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['soon', null],
    ['30', 30_000],
    [['5', '90'], 15_000],
    ['99999', 3_600_000],
  ])('reads %j as %s milliseconds', (input, expected) => {
    expect(refreshIntervalMs(input as string | string[] | undefined)).toBe(expected)
  })
})
