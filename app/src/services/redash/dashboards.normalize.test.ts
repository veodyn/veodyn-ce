// What survives normalizeWidget.
//
// It rebuilds the widget's query ref field by field, so a field it does not name
// is gone before any component sees it, and the symptom is a control that is
// simply missing rather than an error anyone can trace. That is what happened to
// the query's owner: the widget's edit pencil is gated on admin-or-owner, the
// payload carries the owner, and the normalizer dropped it, so in real mode only
// admins ever saw the control.
import { describe, expect, it } from 'vitest'
import { normalizeWidget } from './dashboards'
import type { RedashWidget } from './types'

function rawWidget(query: Record<string, unknown>): RedashWidget {
  return {
    id: 9,
    dashboard_id: 3,
    visualization: {
      id: 90,
      type: 'COUNTER',
      name: 'Temperature',
      description: '',
      options: {},
      query: query as never,
      created_at: '',
      updated_at: '',
    },
    text: '',
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 2, sizeY: 3 } },
    created_at: '',
    updated_at: '',
  }
}

describe('normalizeWidget', () => {
  // The same failure as the owner, one field over. serialize_query sends
  // `options`, which is where the parameter definitions live, and dropping them
  // leaves a dashboard unable to draw a control for its own parameters or to
  // send a widget the values its query requires.
  it('keeps the query parameter definitions the payload carries', () => {
    const widget = normalizeWidget(
      rawWidget({
        id: 11,
        name: 'Weather',
        data_source_id: 1,
        latest_query_data_id: 5,
        options: {
          parameters: [{ name: 'city', title: 'City', type: 'enum', value: 'A', enumOptions: 'A\nB' }],
        },
      }),
      3
    )

    expect(widget.visualization?.query.options?.parameters).toEqual([
      { name: 'city', title: 'City', type: 'enum', value: 'A', enumOptions: 'A\nB' },
    ])
  })

  it('leaves parameters undefined for a query payload without options', () => {
    const widget = normalizeWidget(rawWidget({ id: 11, name: 'Weather', latest_query_data_id: 5 }), 3)

    expect(widget.visualization?.query.options?.parameters).toBeUndefined()
  })

  it('keeps the query owner the payload carries', () => {
    const widget = normalizeWidget(
      rawWidget({ id: 11, name: 'Weather', data_source_id: 1, latest_query_data_id: 5, user: { id: 7, name: 'Owner' } }),
      3
    )

    expect(widget.visualization?.query.user).toEqual({ id: 7, name: 'Owner' })
  })

  it('leaves the owner undefined when the payload has none', () => {
    // Not an empty object: "we were not told" and "owned by nobody" have to stay
    // distinguishable, because the permission check reads the difference.
    const widget = normalizeWidget(rawWidget({ id: 11, name: 'Weather', data_source_id: 1, latest_query_data_id: 5 }), 3)

    expect(widget.visualization?.query.user).toBeUndefined()
  })

  it('still carries the fields the widget draws from', () => {
    const widget = normalizeWidget(
      rawWidget({ id: 11, name: 'Weather', data_source_id: 1, latest_query_data_id: 5 }),
      3
    )

    expect(widget.visualization?.query).toMatchObject({
      id: 11,
      name: 'Weather',
      data_source_id: 1,
      latest_query_data_id: 5,
    })
    expect(widget.dashboard_id).toBe(3)
  })
})
