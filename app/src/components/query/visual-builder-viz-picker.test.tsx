import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { VIZ_CHOICES } from '@/lib/viz-choices'
import { VisualBuilderVizPicker } from './visual-builder-viz-picker'

function renderPicker(value = 'table', enabled: string[] | null = null) {
  const onChange = vi.fn()
  renderWithProviders(<VisualBuilderVizPicker value={value} onChange={onChange} />, {
    // The whole visualizations section, because renderWithProviders merges one
    // level deep: a partial here would drop the fields it does not name.
    config: { visualizations: { enabled, audience: {} } },
  })
  return { onChange }
}

describe('VisualBuilderVizPicker', () => {
  it('offers every choice as a tile, exactly one of them checked', () => {
    renderPicker('chart-bar')

    expect(screen.getAllByRole('radio')).toHaveLength(VIZ_CHOICES.length)
    expect(screen.getByRole('radio', { name: 'Bar' })).toBeChecked()
    expect(screen.getAllByRole('radio').filter((tile) => tile.getAttribute('aria-checked') === 'true'))
      .toHaveLength(1)
  })

  // The point of the change: a picture per choice, not a list of type names.
  it('draws each choice rather than only naming it', () => {
    renderPicker()

    for (const choice of VIZ_CHOICES) {
      const tile = screen.getByRole('radio', { name: choice.label })
      expect(tile.querySelector('svg'), `${choice.label} has no drawing`).toBeInTheDocument()
    }
  })

  it('reports the picked choice by id', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()

    await user.click(screen.getByRole('radio', { name: 'Sankey' }))

    expect(onChange).toHaveBeenCalledWith('sankey')
  })

  // Inherited from the radio group rather than hand-rolled, which is the reason
  // this is a radio group and not a row of toggle buttons.
  it('moves the selection with the arrow keys', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()

    await user.click(screen.getByRole('radio', { name: 'Table' }))
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenLastCalledWith('chart-line')
  })

  it('names the group, so the tiles are not fourteen loose radios', () => {
    renderPicker()

    expect(screen.getByRole('radiogroup', { name: 'Visualization type' })).toBeInTheDocument()
  })
})

// visualizations.enabled in the instance config. It governs what an analyst can
// CREATE; nothing here affects a visualization that already exists.
describe('VisualBuilderVizPicker instance allowlist', () => {
  afterEach(() => vi.restoreAllMocks())

  it('draws a tile only for an allowlisted type', () => {
    renderPicker('table', ['TABLE', 'MAP'])

    expect(screen.getAllByRole('radio').map((tile) => tile.textContent)).toEqual(['Table', 'Map'])
    expect(screen.queryByRole('radio', { name: 'Sankey' })).not.toBeInTheDocument()
  })

  // A chart shape is an option on the CHART type, not a type, so the allowlist
  // has to move all five tiles together.
  it('takes the five chart shapes with the CHART type', () => {
    renderPicker('table', ['TABLE'])
    expect(screen.queryByRole('radio', { name: 'Bar' })).not.toBeInTheDocument()

    cleanup()
    renderPicker('table', ['TABLE', 'CHART'])
    expect(screen.getAllByRole('radio')).toHaveLength(6)
  })

  it('offers every tile when the instance names no allowlist', () => {
    renderPicker('table', null)

    expect(screen.getAllByRole('radio')).toHaveLength(VIZ_CHOICES.length)
  })

  // An operator rolling back to an image without a plugin gets a smaller
  // builder and one log line, not a crash.
  it('ignores a name no plugin in this build registers, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderPicker('table', ['TABLE', 'NOT_IN_THIS_BUILD'])

    expect(screen.getAllByRole('radio').map((tile) => tile.textContent)).toEqual(['Table'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('NOT_IN_THIS_BUILD')
  })

  // An empty radio group reads as a broken render. Say what happened instead.
  it('says so when the allowlist leaves nothing to draw', () => {
    renderPicker('table', [])

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByText(/no visualization types are enabled/i)).toBeInTheDocument()
  })
})
