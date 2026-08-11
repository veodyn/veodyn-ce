// The single declaration of what a visualization type is.
//
// Before this, a type was spread across five places (the type registry, the
// renderer switch, the editor switch, withInferredMapping and VIZ_CHOICES) and
// nothing failed when they disagreed, so four types could render but not be
// created. See docs/visualization-plugins.md.
import type { ComponentType } from 'react'
import type { PlacedAnnotation } from '@/lib/annotation-overlay'
import type { MockVisualization, QueryResultColumn, QueryResultData } from '@/lib/mock-data'
import type { VizThumbnail } from '@/components/visualizations/viz-thumbnails'
import type { OptionSchema } from './option-schema'

/**
 * Bumped only when a change to this interface breaks existing plugins. An
 * integer rather than semver: additive changes need no bump, and nothing else
 * about the interface is negotiable at registration time.
 */
export const PLUGIN_API_VERSION = 1

export interface VisualizationRendererProps {
  visualization: MockVisualization
  data: QueryResultData
  annotations?: PlacedAnnotation[]
}

export interface VisualizationEditorProps {
  options: Record<string, unknown>
  columns: QueryResultColumn[]
  /**
   * The full result, for an editor whose controls are named by VALUES rather
   * than columns (the chart's per-series section lists a series column's
   * distinct values, and a pie's slices). Optional and additive: an editor
   * that reads columns alone keeps working, as does a host with no rows yet.
   */
  data?: QueryResultData
  onChange: (options: Record<string, unknown>) => void
}

/**
 * A Visual builder tile. Most plugins declare exactly one; CHART declares five
 * because a chart shape is an option (`globalSeriesType`) rather than a type.
 * A plugin declaring none is still creatable from the type selector, it just
 * does not appear in the builder, which is a grid of pictures and would have
 * nothing to draw.
 *
 * Deliberately explicit rather than derived from displayName: the builder says
 * "Pivot" and "Map" where the type selector says "Pivot Table" and
 * "Map (Markers)", and inventing a derivation rule to paper over that would
 * silently rename tiles.
 */
export interface VisualizationChoice {
  /** Stable id held in the builder's draft. Not a Redash type. */
  id: string
  label: string
  /** Layered over the plugin's defaultOptions. */
  options: Record<string, unknown>
  Thumbnail: VizThumbnail
}

/**
 * Who may CREATE a visualization of a type.
 *
 * 'internal' is for a type an operator wires up rather than one an analyst
 * reaches for: a wall backdrop is the clearest case, since it is scenery, not
 * an analysis, and offering it in the type selector only invites the question
 * of what it charts. It is a statement about the picker, not a permission:
 * nothing about rendering changes, and a saved visualization of an internal
 * type still draws everywhere it already did.
 */
export type VisualizationAudience = 'analyst' | 'internal'

export interface VisualizationPlugin {
  /** Must equal PLUGIN_API_VERSION. Registration throws otherwise. */
  apiVersion: number
  /** Stable and unique. Matches the Redash visualization `type` column. */
  type: string
  displayName: string
  icon: ComponentType<{ className?: string }>
  defaultOptions: Record<string, unknown>

  /**
   * Defaults to 'analyst'. The plugin declares it because the plugin is what
   * knows whether the type is something to analyse with; an instance can still
   * override either direction through `visualizations.audience` in config, so
   * this is a default rather than a verdict.
   */
  audience?: VisualizationAudience

  /**
   * What this type needs before it can draw. Defaults to 'query-result', which
   * is what every core type is: a view of the rows its query returned.
   *
   * 'none' is for a plugin that draws from something else, or from nothing: an
   * external feed it fetches itself, another query it looks up, or no data at
   * all. Such a type is still attached to a query (a Redash visualization row
   * belongs to one), it simply does not wait for that query's result, and the
   * render surfaces stop showing "No data" in front of it. It is handed
   * EMPTY_QUERY_RESULT when no result exists, so it never has to type-guard
   * the argument.
   */
  needs?: 'query-result' | 'none'

  Renderer: ComponentType<VisualizationRendererProps>
  /** Omit for a type with nothing to configure. */
  Editor?: ComponentType<VisualizationEditorProps>

  /**
   * Seed options from the shape of a result, when the type is first chosen.
   * Must not overwrite options the analyst already set.
   */
  inferOptions?(
    defaults: Record<string, unknown>,
    data: QueryResultData
  ): Record<string, unknown>

  /**
   * Why this visualization cannot draw, given real data. Empty array when it
   * is fine. Surfaced in the editor and beside the rendered visualization, so
   * it must never throw.
   */
  validate?(options: Record<string, unknown>, data: QueryResultData): string[]

  choices?: VisualizationChoice[]

  /**
   * Which options survive into a public report, a print view, or any other
   * response an unauthenticated reader can fetch. Options are rebuilt from
   * this key by key; anything undeclared is dropped.
   *
   * Declaring a key asserts its value is safe to publish. Omitting the whole
   * field means "nothing is", which is the safe default but renders the
   * visualization with no configuration at all, so a type meant to be shared
   * has to say so. See lib/public-report-options.ts.
   */
  publicOptions?: OptionSchema
}
