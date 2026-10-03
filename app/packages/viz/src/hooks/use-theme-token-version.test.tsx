import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { VeodynProvider } from '../embed/veodyn-provider'
import { useVizEnvironment } from '../lib/viz-environment'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeTokenVersion } from './use-theme-token-version'

afterEach(() => {
  document.documentElement.className = ''
})

describe('useThemeTokenVersion', () => {
  it('changes when the theme class is added', async () => {
    const { result } = renderHook(() => useThemeTokenVersion())
    const before = result.current

    await act(async () => {
      document.documentElement.classList.add('dark')
    })

    expect(result.current).not.toBe(before)
  })

  it('changes again when the theme class is removed', async () => {
    document.documentElement.classList.add('dark')
    const { result } = renderHook(() => useThemeTokenVersion())
    const before = result.current

    await act(async () => {
      document.documentElement.classList.remove('dark')
    })

    expect(result.current).not.toBe(before)
  })

  it('does not change when an unrelated attribute changes', async () => {
    const { result } = renderHook(() => useThemeTokenVersion())
    const before = result.current

    await act(async () => {
      document.documentElement.setAttribute('lang', 'de')
    })

    expect(result.current).toBe(before)
  })
})

describe('useThemeTokenVersion on a scoped root', () => {
  it('changes when the theme attribute of the root it watches changes', async () => {
    const root = document.createElement('div')
    root.setAttribute('data-theme', 'light')
    document.body.appendChild(root)
    const { result } = renderHook(() => useThemeTokenVersion(root))
    const before = result.current

    await act(async () => {
      root.setAttribute('data-theme', 'dark')
    })

    expect(result.current).not.toBe(before)
    root.remove()
  })

  it('changes when a provider switches its theme', async () => {
    function Probe() {
      return <output>{useThemeTokenVersion(useVizEnvironment().root)}</output>
    }
    const { rerender } = render(
      <VeodynProvider baseUrl="https://veodyn.test" theme="light">
        <Probe />
      </VeodynProvider>
    )
    const before = screen.getByRole('status').textContent

    rerender(
      <VeodynProvider baseUrl="https://veodyn.test" theme="dark">
        <Probe />
      </VeodynProvider>
    )

    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(before))
  })
})
