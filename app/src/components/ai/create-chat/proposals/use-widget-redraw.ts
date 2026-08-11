'use client'

// Getting a visualization for a widget the proposal wants drawn differently.
//
// Redash cannot repoint a widget: WidgetResource.post writes `text` and
// `options` and says so in its own docstring ("This method currently handles
// Text Box widgets only"). So a redraw is a delete and a create, and the create
// needs a visualization id to point at.
//
// Sometimes that id already exists, which is the cheap case and touches nothing
// outside the dashboard. When it does not, one has to be built ON THE SAVED
// QUERY, and that is a shared object: every dashboard, alert and reader of that
// query sees what is added to it. Doing that to a query somebody else owns, to
// satisfy a change to one dashboard, is the surprise this module exists to
// avoid. Such a query is forked first and the visualization goes on the copy.
import { useConfig } from '@/components/config/config-provider'
import { useCreateVisualization } from '@/hooks/use-visualizations'
import { useForkQuery, useUpdateQuery } from '@/hooks/use-queries'
import { inferredVizOptions } from '@/lib/visualizations'
import { resolveVizChoice } from '@/lib/viz-choices'
import { executeSavedQuery } from '@/services/redash/execution'
import { useAuthStore } from '@/stores/auth-store'
import type { DashboardWidgetProposal } from '@/types/ai-create'

/**
 * Just the parts of a saved query a redraw reads.
 *
 * Structural rather than `RedashQuery`, because the card holds whatever
 * `useAllQueries` returns and that is `MockQuery` in mock mode. Naming the four
 * fields this actually touches lets both satisfy it without a cast that would
 * also silence a real mismatch.
 */
export interface RedrawSource {
  id: number
  name: string
  user?: { id: number } | null
  visualizations?: { id: number; type: string; name: string; options?: unknown }[]
}

/** What a redrawn widget should be built from. */
export interface Redrawn {
  queryId: number
  queryName: string
  visualizationId: number
  type: string
  name: string
  options: Record<string, unknown>
  /** The query this was copied out of, when the reader did not own it. */
  forkedFrom: number | null
}

// Long enough that any stored result is accepted. The column mapping is
// inferred from whatever the query last returned, and re-running a saved query
// on the way to changing its chart type is a wait for a value nobody asked to
// refresh. Redash reads max_age in seconds; -1 would force exactly the re-run
// this avoids.
const ANY_STORED_RESULT = 60 * 60 * 24 * 365

export function useWidgetRedraw() {
  const currentUser = useAuthStore((state) => state.currentUser)
  const draftsEnabled = useConfig().features.query_drafts
  const forkQuery = useForkQuery()
  const updateQuery = useUpdateQuery()
  const createVisualization = useCreateVisualization()

  /**
   * Whether the reader may add a visualization to this query.
   *
   * Ownership, deliberately stricter than `currentUser.canEdit`, which also
   * answers true for any admin. An admin CAN write to somebody else's query;
   * the question here is whether doing so as a side effect of editing a
   * dashboard would surprise its owner, and for a shared query it would.
   */
  function owns(query: RedrawSource): boolean {
    return currentUser != null && query.user?.id === currentUser.id
  }

  /**
   * The query to build on: this one, or a copy of it the reader owns.
   *
   * Same two-step the Fork menu item runs, and for the same reason: Query.fork
   * builds a bare Query whose is_draft defaults to true, and with the draft
   * workflow off nothing in the app would ever bring the copy back out of that
   * state, so it would sit in its author's list and nobody else's.
   */
  async function writableCopy(query: RedrawSource): Promise<RedrawSource> {
    const forked = (await forkQuery.mutateAsync(query.id)) as RedrawSource
    if (!draftsEnabled) await updateQuery.mutateAsync({ id: forked.id, is_draft: false })
    return forked
  }

  /**
   * The visualization this widget should point at once it is rebuilt.
   *
   * A proposal carrying `visualizationId` names one the query already has, so
   * nothing is written anywhere. A proposal carrying only a shape means the
   * query has nothing of that shape and one has to be made.
   */
  async function redraw(
    proposal: DashboardWidgetProposal,
    query: RedrawSource
  ): Promise<Redrawn> {
    const choice = resolveVizChoice(proposal.vizChoiceId ?? '')
    if (proposal.visualizationId != null) {
      const existing = query.visualizations?.find((one) => one.id === proposal.visualizationId)
      return {
        queryId: query.id,
        queryName: query.name,
        visualizationId: proposal.visualizationId,
        type: existing?.type ?? choice.type,
        name: existing?.name ?? choice.label,
        options: (existing?.options as Record<string, unknown>) ?? {},
        forkedFrom: null,
      }
    }

    const target = owns(query) ? query : await writableCopy(query)
    // The plugin's own inference over the query's stored result, the same call
    // the edit dialog makes when a type is picked. A choice carries only what
    // makes it that shape (`{globalSeriesType: 'bar'}`), so without this the
    // visualization is saved with no column mapping and draws whatever its
    // renderer falls back to.
    //
    // A result that cannot be read is not a reason to refuse the redraw: the
    // chart is then configured exactly as well as the type picker would have
    // configured it, which is the state every hand-made visualization starts in.
    let options = choice.options
    try {
      const result = await executeSavedQuery(target.id, { maxAge: ANY_STORED_RESULT })
      options = inferredVizOptions(choice.type, choice.options, result.data)
    } catch {
      options = choice.options
    }

    const created = await createVisualization.mutateAsync({
      queryId: target.id,
      type: choice.type,
      name: choice.label,
      options,
    })
    return {
      queryId: target.id,
      queryName: target.name,
      visualizationId: created.id,
      type: choice.type,
      name: choice.label,
      options,
      forkedFrom: target.id === query.id ? null : query.id,
    }
  }

  return {
    redraw,
    isPending: forkQuery.isPending || createVisualization.isPending || updateQuery.isPending,
  }
}
