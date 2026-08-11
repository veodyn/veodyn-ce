// Applying an AI-proposed change to a dashboard that exists.
//
// The rule itself is unit-tested in dashboard-edit-model.test.ts. This file is
// about the half that cannot be: that the ids handed to the delete call come
// from the dashboard rather than from the model, that a user is shown what is
// about to be removed before they can press anything, and that a partial apply
// is reported instead of passing for a whole one.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDashboards, mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { resetStores } from '@/test/utils'
import {
  DASHBOARD_ID,
  currentWidgets,
  firstAbsentQuery,
  proposalOf,
  removableWidgets,
  renderCard,
} from './dashboard-edit-proposal.test-helpers'

interface CreateCall {
  dashboardId: number
  visualization?: { id: number; query: { id: number } }
  options?: { position: { col: number; row: number; sizeX: number; sizeY: number } }
}
interface DeleteCall {
  dashboardId: number
  widgetId: number
}

const widgets = vi.hoisted(() => ({
  created: [] as CreateCall[],
  deleted: [] as DeleteCall[],
  failDeleteId: null as number | null,
  // Found in review: the fake could only refuse a DELETE, so an
  // implementation that swallowed every create failure and still reported
  // success passed the whole file.
  failCreateQueryId: null as number | null,
}))

vi.mock('@/hooks/use-widgets', () => ({
  useCreateWidget: () => ({
    mutateAsync: async (vars: CreateCall) => {
      widgets.created.push(vars)
      if (vars.visualization?.query.id === widgets.failCreateQueryId) {
        throw new Error('Widget refused')
      }
      return vars
    },
  }),
  useDeleteWidget: () => ({
    mutateAsync: async (vars: DeleteCall) => {
      widgets.deleted.push(vars)
      if (vars.widgetId === widgets.failDeleteId) throw new Error('Widget refused')
      return vars
    },
  }),
}))

beforeEach(() => {
  resetStores()
  widgets.created = []
  widgets.deleted = []
  widgets.failDeleteId = null
  widgets.failCreateQueryId = null
  useMockDataStore.setState({
    dashboards: mockDashboards.map((dashboard) => ({ ...dashboard })),
    queries: mockQueries.map((query) => ({ ...query })),
  })
})

describe('DashboardEditProposalCard', () => {
  it('cannot be applied before it knows what is on the dashboard', async () => {
    // The dashboard arrives through a query, so the card's first render knows
    // of no widgets at all. Everything proposed then looks like an addition
    // and nothing looks like a removal, so an Apply pressed in that window
    // duplicates every panel already there. The button has to wait.
    const present = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    renderCard(proposalOf(present))

    expect(screen.getByRole('button', { name: /apply change/i })).toBeDisabled()

    // And still refused once loaded, because this proposal changes nothing:
    // the assertion above must not be passing for that reason instead.
    expect(await screen.findByText(/already holds/i)).toBeInTheDocument()
  })

  it('refuses a removal proposed before the dashboard is known', async () => {
    // The dangerous half of the same window. A proposal naming one widget is
    // "remove the rest" once loaded and "add one" before, so a card that acts
    // early does the opposite of what it is about to show.
    const keptQueryId = currentWidgets()[0]?.visualization?.query?.id as number
    renderCard(proposalOf([keptQueryId]))

    expect(screen.getByRole('button', { name: /apply change/i })).toBeDisabled()
    await screen.findByText('Removing')
    expect(screen.getByRole('button', { name: /apply change/i })).toBeEnabled()
  })

  it('puts a new widget below the ones already on the dashboard', async () => {
    // Positions are absolute, so numbering additions from zero drops them on
    // top of the widgets already there.
    const user = userEvent.setup()
    const present = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    const lowestFreeRow = currentWidgets().reduce(
      (low, one) => Math.max(low, one.options.position.row + one.options.position.sizeY),
      0
    )
    renderCard(proposalOf([...present, firstAbsentQuery(present)]))
    await screen.findByText('Adding')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.created.length).toBe(1))
    expect(widgets.created[0]?.options?.position.row).toBeGreaterThanOrEqual(lowestFreeRow)
  })

  it('names what it is about to remove before anything is pressed', async () => {
    // The destructive half has to be readable in advance. A card that only
    // listed the end state would leave the user diffing it by eye against the
    // page behind the dialog.
    const kept = currentWidgets()[0]?.visualization?.query?.id
    expect(kept).toBeDefined()
    renderCard(proposalOf([kept as number]))

    expect(await screen.findByText('Removing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply change/i })).toBeEnabled()
  })

  it('deletes by the id on the dashboard, never one from the proposal', async () => {
    // The whole division of labour: the model names queries, this half owns
    // ids. A widget id that came from a model is a widget somebody else was
    // using.
    const user = userEvent.setup()
    const keptQueryId = currentWidgets()[0]?.visualization?.query?.id as number
    const doomed = removableWidgets(keptQueryId)
    renderCard(proposalOf([keptQueryId]))
    await screen.findByText('Removing')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.deleted.length).toBe(doomed.length))
    expect(widgets.deleted.map((call) => call.widgetId).sort()).toEqual(
      doomed.map((one) => one.id).sort()
    )
    expect(widgets.deleted.every((call) => call.dashboardId === DASHBOARD_ID)).toBe(true)
  })

  it('adds a widget the dashboard does not already hold', async () => {
    const user = userEvent.setup()
    const present = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    const newcomer = firstAbsentQuery(present)
    renderCard(proposalOf([...present, newcomer]))
    await screen.findByText('Adding')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.created.length).toBe(1))
    expect(widgets.created[0]?.visualization?.query.id).toBe(newcomer)
    expect(widgets.deleted).toEqual([])
  })

  it('refuses to apply a change that would change nothing', async () => {
    const present = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    renderCard(proposalOf(present))

    expect(await screen.findByText(/already holds/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply change/i })).toBeDisabled()
  })

  it('names the widget that did not land instead of reporting a whole change', async () => {
    const user = userEvent.setup()
    const keptQueryId = currentWidgets()[0]?.visualization?.query?.id as number
    widgets.failDeleteId = removableWidgets(keptQueryId)[0]?.id ?? null
    renderCard(proposalOf([keptQueryId]))
    await screen.findByText('Removing')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    // Scoped to role="alert" (a partial-apply caution is assertive) rather
    // than a bare text query: the same message is also painted by the
    // visible toast, so an unscoped query matches twice.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/except for 1 widget/i))
    // And it does not claim a dashboard was created: nothing was, and that is
    // what the shared creation message would have said.
    expect(screen.queryByText(/was created/i)).not.toBeInTheDocument()
  })

  it('names an addition that did not land, not just a removal', async () => {
    const user = userEvent.setup()
    const present = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    const newcomer = firstAbsentQuery(present)
    widgets.failCreateQueryId = newcomer
    renderCard(proposalOf([...present, newcomer]))
    await screen.findByText('Adding')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    // Scoped to role="alert" (a partial-apply caution is assertive) rather
    // than a bare text query: the same message is also painted by the
    // visible toast, so an unscoped query matches twice.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/except for 1 widget/i))
  })

  it('places an addition below a widget whose removal was refused', async () => {
    // Found in review. A refused delete leaves the widget on the dashboard,
    // so sizing the additions against the removals that were merely INTENDED
    // drops the new panel on top of one that is still there.
    const user = userEvent.setup()
    const keptQueryId = currentWidgets()[0]?.visualization?.query?.id as number
    // The LOWEST removable widget specifically. If the refused one sits above
    // another survivor, both the intended-removal and actual-removal
    // computations give the same row and the assertion cannot tell them apart.
    const stubborn = removableWidgets(keptQueryId).reduce((lowest, one) =>
      one.options.position.row + one.options.position.sizeY >
      lowest.options.position.row + lowest.options.position.sizeY
        ? one
        : lowest
    )
    widgets.failDeleteId = stubborn?.id ?? null
    const stubbornBottom =
      (stubborn?.options.position.row ?? 0) + (stubborn?.options.position.sizeY ?? 0)
    // Absent from EVERY query on the dashboard, or it is not an addition.
    const presentIds = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    renderCard(proposalOf([keptQueryId, firstAbsentQuery(presentIds)]))
    await screen.findByText('Adding')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    await waitFor(() => expect(widgets.created.length).toBe(1))
    expect(widgets.created[0]?.options?.position.row).toBeGreaterThanOrEqual(stubbornBottom)
  })

  it('leaves the user on the dashboard they just changed', async () => {
    const user = userEvent.setup()
    const present = currentWidgets()
      .map((one) => one.visualization?.query?.id)
      .filter((id): id is number => id != null)
    const { onCreated } = renderCard(proposalOf([...present, firstAbsentQuery(present)]))
    await screen.findByText('Adding')

    await user.click(screen.getByRole('button', { name: /apply change/i }))

    // Null, not a href: navigating away from the thing they just edited is
    // not a reward for editing it.
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(null))
  })
})
