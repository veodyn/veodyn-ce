import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from '@/components/config/config-provider'
import { Button } from '@/components/ui/button'
import { NEUTRAL_CONFIG, toClientConfig } from '@/lib/config-schema'
import { renderWithProviders } from '@/test/utils'
import { AnnotationDialog } from './annotation-dialog'
import type { Annotation } from '@/types/annotation'
import type { FeatureDescriptor } from '@/features/types'

/**
 * Whatever a feature puts in the dashboard.annotationSuggest slot, standing in
 * for it.
 *
 * A function DECLARATION so the hoisted mock factory below can close over it.
 * What it draws is deliberately the plainest thing that answers the question
 * the dialog asks the registry: is there an affordance here or not.
 */
function SuggestPanelStub() {
  return <Button variant="outline">Suggest annotations</Button>
}

// One contributor, declared here rather than inherited from whatever the tree
// has installed. The last case is about the gate in front of the slot, and with
// no contributor to gate it could only ever have said that nothing renders,
// which is the same answer it gives when the gate is broken.
vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    drafts: {
      id: 'drafts',
      nav: [],
      routes: [],
      slots: { 'dashboard.annotationSuggest': async () => ({ default: SuggestPanelStub }) },
    },
  }
  return { FEATURES }
})

const existingAnnotations: Annotation[] = [
  {
    id: 1,
    dashboard_id: 1,
    widget_id: null,
    start: '2026-03-05T00:00:00Z',
    end: null,
    label: 'K Line extension opens to the public',
    source: 'manual',
    created_at: '2026-03-05T09:00:00Z',
  },
]

const createMutate = vi.fn()
const deleteMutate = vi.fn()

vi.mock('@/hooks/use-annotations', () => ({
  useAnnotations: () => ({ data: existingAnnotations, isLoading: false }),
  useCreateAnnotation: () => ({ mutate: createMutate }),
  useDeleteAnnotation: () => ({ mutate: deleteMutate }),
}))

beforeEach(() => {
  createMutate.mockReset()
  deleteMutate.mockReset()
})

/** A create that answers the way the absent annotations backend does. */
function createRejects(message: string) {
  createMutate.mockImplementation(
    (_payload: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new Error(message))
    }
  )
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.type(screen.getByLabelText(/label/i), label)
  fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: '2026-04-01T09:00' } })
  await user.click(screen.getByRole('button', { name: /add annotation/i }))
}

function renderDialog(aiEnabled = false) {
  const config = {
    ...toClientConfig(NEUTRAL_CONFIG),
    ai: { enabled: aiEnabled },
  }
  return renderWithProviders(
    <ConfigProvider value={config}>
      <AnnotationDialog open onClose={() => {}} dashboardId={1} widgetId={7} />
    </ConfigProvider>
  )
}

describe('AnnotationDialog', () => {
  it('lists existing annotations for the dashboard', () => {
    renderDialog()
    expect(screen.getByText('K Line extension opens to the public')).toBeInTheDocument()
  })

  it('labels the start and end fields as UTC and explains the convention', () => {
    renderDialog()

    expect(screen.getByLabelText(/^start \(utc\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^end \(utc, optional\)/i)).toBeInTheDocument()
    expect(screen.getByText(/times are utc, matching the chart axis/i)).toBeInTheDocument()
  })

  it('deleting a listed annotation calls delete with its id', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /delete annotation/i }))

    expect(deleteMutate).toHaveBeenCalledWith(1)
  })

  it('gives each delete button an accessible name that includes the annotation label', () => {
    renderDialog()

    expect(
      screen.getByRole('button', { name: 'Delete annotation K Line extension opens to the public' })
    ).toBeInTheDocument()
  })

  it('submitting the form calls create with the right payload', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/label/i), 'Signal outage')
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: '2026-04-01T09:00' } })

    await user.click(screen.getByRole('button', { name: /add annotation/i }))

    // Second argument is the success/error pair the form now hands the
    // mutation, so the payload assertion reads the first argument alone.
    expect(createMutate.mock.calls[0][0]).toEqual({
      dashboard_id: 1,
      widget_id: null,
      start: '2026-04-01T09:00',
      end: null,
      label: 'Signal outage',
      source: 'manual',
    })
  })

  it('pins the annotation to the widget when the toggle is checked', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/label/i), 'Sensor recalibration')
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: '2026-04-02T08:30' } })
    await user.click(screen.getByRole('checkbox', { name: /pin to this widget only/i }))

    await user.click(screen.getByRole('button', { name: /add annotation/i }))

    expect(createMutate.mock.calls[0][0]).toMatchObject({ widget_id: 7 })
  })

  // The write against a real Redash answered 405, and the form cleared itself
  // regardless, so a discarded annotation looked exactly like a saved one.
  it('says so when the write is refused, instead of clearing as though it saved', async () => {
    const user = userEvent.setup()
    createRejects('Method Not Allowed')
    renderDialog()

    await fillAndSubmit(user, 'Signal outage')

    expect(screen.getByText(/was not saved/i)).toBeInTheDocument()
    expect(screen.getByText(/Method Not Allowed/)).toBeInTheDocument()
    // The draft survives, so there is something left to retry.
    expect(screen.getByLabelText(/label/i)).toHaveValue('Signal outage')
  })

  it('clears the form once the write is accepted', async () => {
    const user = userEvent.setup()
    createMutate.mockImplementation(
      (_payload: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
    )
    renderDialog()

    await fillAndSubmit(user, 'Signal outage')

    expect(screen.getByLabelText(/label/i)).toHaveValue('')
    expect(screen.queryByText(/was not saved/i)).not.toBeInTheDocument()
  })

  it('does not create an annotation when the label is empty', async () => {
    const user = userEvent.setup()
    renderDialog()

    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: '2026-04-01T09:00' } })
    await user.click(screen.getByRole('button', { name: /add annotation/i }))

    expect(createMutate).not.toHaveBeenCalled()
  })

  it('does not create an annotation when start is missing', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText(/label/i), 'No start time')
    await user.click(screen.getByRole('button', { name: /add annotation/i }))

    expect(createMutate).not.toHaveBeenCalled()
  })

  // Two gates in series, and this is the one the dialog owns. Whether the
  // instance offers AI at all is config; whether this build has a feature that
  // answers is the registry, stubbed at the top of this file with a contributor
  // so that "nothing rendered" cannot pass for "correctly gated".
  it('mounts the suggestion affordance only when AI is enabled', async () => {
    const disabled = renderDialog(false)
    expect(
      screen.queryByRole('button', { name: 'Suggest annotations' })
    ).not.toBeInTheDocument()
    // The dialog is community and is whole without the panel: the form and the
    // list of existing annotations are here either way, which is also what a
    // build with no contributor for dashboard.annotationSuggest shows.
    expect(screen.getByLabelText(/label/i)).toBeInTheDocument()
    expect(screen.getByText('K Line extension opens to the public')).toBeInTheDocument()
    disabled.unmount()

    renderDialog(true)
    // Awaited, not synchronous: a contribution to dashboard.annotationSuggest
    // comes through a loader, so it arrives a render after the dialog rather
    // than with it.
    expect(
      await screen.findByRole('button', { name: 'Suggest annotations' })
    ).toBeInTheDocument()
  })
})
