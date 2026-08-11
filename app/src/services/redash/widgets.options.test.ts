// The widget `options` blob, which the backend REPLACES rather than merges.
//
// That makes every write here a whole-object write: any key the caller leaves
// out of `options` is deleted server-side. The visible failure is a widget that
// jumps back to the top-left of the grid, or a parameter mapping that resets to
// the dashboard-level default, after an edit that only meant to change the
// title.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createWidget, deleteWidget, updateWidget } from './widgets'

const post = vi.fn()
const del = vi.fn()

vi.mock('@/services/api-client', () => ({
  redashApi: {
    post: (path: string, data?: unknown) => post(path, data),
    delete: (path: string) => del(path),
    get: vi.fn(),
  },
  ApiError: class extends Error {},
}))

const POSITION = { col: 0, row: 0, sizeX: 3, sizeY: 4 }

const CREATED = {
  id: 55,
  dashboard_id: 7,
  visualization: {
    id: 90,
    type: 'COUNTER',
    name: 'Temperature',
    description: '',
    options: {},
    query: { id: 11, name: 'Weather', data_source_id: 1, latest_query_data_id: 5 },
    created_at: '',
    updated_at: '',
  },
  text: '',
  width: 1,
  options: { position: { ...POSITION, autoHeight: false }, isHidden: false },
  created_at: '',
  updated_at: '',
}

function bodyOfLastPost(): Record<string, unknown> {
  return post.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  post.mockReset()
  del.mockReset()
  post.mockResolvedValue(CREATED)
  del.mockResolvedValue(undefined)
})

describe('createWidget', () => {
  it('posts to the widgets collection with the dashboard it belongs to', async () => {
    await createWidget({ dashboard_id: 7, visualization_id: 90, options: { position: POSITION } })

    expect(post.mock.calls[0][0]).toBe('widgets')
    expect(bodyOfLastPost()).toMatchObject({ dashboard_id: 7, visualization_id: 90 })
  })

  // visualization_id must be present even for a text widget: Redash rejects the
  // create when the key is missing, and null is how a text box says it has no
  // visualization.
  it('sends an explicit null visualization_id for a text widget', async () => {
    await createWidget({
      dashboard_id: 7,
      visualization_id: null,
      text: 'Notes',
      options: { position: POSITION },
    })

    expect(bodyOfLastPost()).toHaveProperty('visualization_id', null)
    expect(bodyOfLastPost().text).toBe('Notes')
  })

  it('sends an empty text and a width of one when the caller gives neither', async () => {
    await createWidget({ dashboard_id: 7, visualization_id: 90, options: { position: POSITION } })

    expect(bodyOfLastPost()).toMatchObject({ text: '', width: 1 })
  })

  it('keeps an explicit width', async () => {
    await createWidget({
      dashboard_id: 7,
      visualization_id: 90,
      width: 2,
      options: { position: POSITION },
    })

    expect(bodyOfLastPost().width).toBe(2)
  })

  // A new widget is visible. Leaving isHidden out entirely reads as undefined
  // on some code paths, which is not the same as false.
  it('defaults a new widget to visible', async () => {
    await createWidget({ dashboard_id: 7, visualization_id: 90, options: { position: POSITION } })

    expect(bodyOfLastPost().options).toMatchObject({ isHidden: false })
  })

  it('lets the caller create a hidden widget anyway', async () => {
    await createWidget({
      dashboard_id: 7,
      visualization_id: 90,
      options: { position: POSITION, isHidden: true },
    })

    expect(bodyOfLastPost().options).toMatchObject({ isHidden: true })
  })

  // autoHeight lives INSIDE position, so the default has to be spread into the
  // caller's position rather than set beside it. Set it at the top level and
  // the grid reads no autoHeight at all and sizes the widget by hand.
  it('defaults autoHeight inside the position, not next to it', async () => {
    await createWidget({ dashboard_id: 7, visualization_id: 90, options: { position: POSITION } })

    expect(bodyOfLastPost().options).toEqual({
      isHidden: false,
      position: { ...POSITION, autoHeight: false },
    })
  })

  it('keeps the caller position rather than being overwritten by the default', async () => {
    await createWidget({
      dashboard_id: 7,
      visualization_id: 90,
      options: { position: { col: 2, row: 5, sizeX: 1, sizeY: 2 } },
    })

    expect(bodyOfLastPost().options).toMatchObject({
      position: { col: 2, row: 5, sizeX: 1, sizeY: 2, autoHeight: false },
    })
  })

  it('carries the parameter mappings through untouched', async () => {
    await createWidget({
      dashboard_id: 7,
      visualization_id: 90,
      options: { position: POSITION, parameterMappings: { city: { type: 'dashboard-level' } } },
    })

    expect(bodyOfLastPost().options).toMatchObject({
      parameterMappings: { city: { type: 'dashboard-level' } },
    })
  })

  it('normalizes the created widget instead of returning the raw body', async () => {
    const widget = await createWidget({
      dashboard_id: 7,
      visualization_id: 90,
      options: { position: POSITION },
    })

    expect(widget.id).toBe(55)
    expect(widget.dashboard_id).toBe(7)
    expect(widget.visualization?.query).toMatchObject({ id: 11, name: 'Weather' })
  })

  // The create response omits dashboard_id on some Redash versions, and a
  // widget that does not know its dashboard cannot be re-saved or moved.
  it('falls back to the dashboard the caller named when the response omits it', async () => {
    post.mockResolvedValue({ ...CREATED, dashboard_id: undefined })

    const widget = await createWidget({
      dashboard_id: 7,
      visualization_id: 90,
      options: { position: POSITION },
    })

    expect(widget.dashboard_id).toBe(7)
  })
})

describe('updateWidget', () => {
  it('posts to the member path', async () => {
    await updateWidget(55, { options: { position: POSITION } })

    expect(post.mock.calls[0][0]).toBe('widgets/55')
  })

  // Sent verbatim, because the backend replaces the blob. The caller is the one
  // that has to have merged position + parameterMappings + isHidden first, and
  // this service must not quietly re-add defaults that would clobber them.
  it('sends the options object exactly as given', async () => {
    const options = {
      position: { ...POSITION, autoHeight: true },
      isHidden: true,
      parameterMappings: { city: { type: 'widget-level', value: 'LA' } },
    }

    await updateWidget(55, { options })

    expect(bodyOfLastPost().options).toEqual(options)
  })

  it('does not inject an isHidden or autoHeight default on update', async () => {
    await updateWidget(55, { options: { position: POSITION } })

    expect(bodyOfLastPost().options).toEqual({ position: POSITION })
  })

  it('sends an empty text and a width of one when the caller gives neither', async () => {
    await updateWidget(55, { options: { position: POSITION } })

    expect(bodyOfLastPost()).toMatchObject({ text: '', width: 1 })
  })

  it('keeps the text and width the caller gave', async () => {
    await updateWidget(55, { text: 'Notes', width: 2, options: { position: POSITION } })

    expect(bodyOfLastPost()).toMatchObject({ text: 'Notes', width: 2 })
  })
})

describe('deleteWidget', () => {
  it('deletes the member path', async () => {
    await deleteWidget(55)

    expect(del).toHaveBeenCalledWith('widgets/55')
    expect(post).not.toHaveBeenCalled()
  })
})
