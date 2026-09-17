'use client'

// The registry seam for components, and the one place in src/features that
// renders anything.
//
// A slot is a hole a community surface leaves for an installed feature to fill.
// The community component owns the surface; whatever needs an absent feature is
// asked for by id, resolved through the registry, and loaded only when the
// surface renders.
//
// Three properties this file exists to hold:
//
//   1. No contributor is not a failure: the fallback renders and no loader is
//      entered.
//   2. A loader that REJECTS also renders the fallback, so a community build
//      pointed at an enterprise API degrades to the community view rather than
//      to a blank page. React.lazy rethrows a rejected loader during render by
//      default, so the rejection is caught here instead.
//   3. Nothing on the pre-paint path. Like features/search-sources.ts, this
//      module is NOT re-exported from features/index.ts, which the server root
//      layout reaches through src/lib/theme-preference.ts.
//
// Two renderers: `<Slot>` takes the first answer, `<SlotList>` renders every
// one. Which a slot belongs to is declared in the type system (SingleSlotId,
// MultiSlotId in ./types), not chosen at the call site.
import {
  Fragment,
  Suspense,
  createElement,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { FEATURES } from './generated-registry'
import { featureList } from './index'
import type {
  FeatureDescriptor,
  MultiSlotId,
  NavRowBadgeSlotId,
  SingleSlotId,
  SlotId,
  SlotLoader,
  SlotProps,
} from './types'

type Registry = Record<string, FeatureDescriptor>

/**
 * What the cached lazy component is rendered with: the slot's own props, plus
 * the fallback to show if the load already failed.
 *
 * The fallback travels as a prop rather than being closed over when the lazy is
 * built, because the lazy is cached and reused across renders while the
 * fallback is whatever this render passed.
 */
interface ShellProps<Id extends SlotId> {
  slotProps: SlotProps[Id]
  fallback: ReactNode
}

type Shell<Id extends SlotId> = LazyExoticComponent<ComponentType<ShellProps<Id>>>

interface Contributor<Id extends SlotId> {
  featureId: string
  load: SlotLoader<Id>
}

/**
 * Lazy components, keyed on the registry object and then on slot AND feature.
 *
 * React.lazy must not be called during render without a stable identity, or
 * every render mounts a new component and the load restarts. Keying on registry
 * identity, the same way assembleSearchSources does, gives the shipped FEATURES
 * one entry and each test's stub registry its own, with no reset hook for a
 * test to remember to call.
 *
 * The feature id is in the key because a multi slot has one shell per
 * contributor.
 */
const shells = new WeakMap<Registry, Map<string, Shell<SlotId>>>()

/**
 * Every installed feature that fills this slot, in featureList order, so what
 * renders first is a property of the build and not of however an object literal
 * happened to be typed.
 */
function contributorsFor<Id extends SlotId>(id: Id, registry: Registry): Contributor<Id>[] {
  const found: Contributor<Id>[] = []
  for (const feature of featureList(registry)) {
    const load = feature.slots?.[id]
    if (load) found.push({ featureId: feature.id, load })
  }
  return found
}

/**
 * The first installed feature that fills this slot. First wins rather than
 * last, and rather than an error: two features contributing one SingleSlotId is
 * a packaging mistake, and a build that refuses to render Home over it is
 * worse. A slot where two contributors are the design is a MultiSlotId and goes
 * through SlotList instead.
 */
function contributorFor<Id extends SlotId>(id: Id, registry: Registry): Contributor<Id> | undefined {
  return contributorsFor(id, registry)[0]
}

function buildShell<Id extends SlotId>(id: Id, featureId: string, load: SlotLoader<Id>): Shell<Id> {
  return lazy(async () => {
    try {
      const { default: Contributed } = await load()
      return { default: ({ slotProps }: ShellProps<Id>) => <Contributed {...slotProps} /> }
    } catch (reason) {
      const error = new AppError(
        ErrorIds.SLOT_UNAVAILABLE,
        "A feature's slot component could not be loaded; the community fallback was rendered instead",
        { slot: id, feature: featureId, reason: String(reason) }
      )
      console.error(error.toLogLine())
      return { default: ({ fallback }: ShellProps<Id>) => <>{fallback}</> }
    }
  })
}

function shellFor<Id extends SlotId>(
  id: Id,
  contributor: Contributor<Id>,
  registry: Registry
): Shell<Id> {
  let byKey = shells.get(registry)
  if (!byKey) {
    byKey = new Map()
    shells.set(registry, byKey)
  }
  const key = `${id}\0${contributor.featureId}`
  const cached = byKey.get(key)
  // The cache is keyed by slot id, so every entry's props are that slot's, but
  // the map itself cannot say so across the union.
  if (cached) return cached as Shell<Id>

  const shell = buildShell(id, contributor.featureId, contributor.load)
  byKey.set(key, shell as Shell<SlotId>)
  return shell
}

/**
 * Whether any installed feature fills this slot. Synchronous and loader-free:
 * it reads the descriptors only, so a surface that has to size itself before it
 * knows what will render can ask without entering anyone's loader.
 */
export function hasSlotContributor(id: SlotId, registry: Registry = FEATURES): boolean {
  return contributorFor(id, registry) !== undefined
}

/**
 * Render whatever fills `id`, or `fallback` if nothing does, or nothing can.
 *
 * `fallback` is also the Suspense fallback, so the surface holds the community
 * view while the contributed chunk loads. Pass `null` where showing nothing is
 * the honest community answer.
 */
export function Slot<Id extends SingleSlotId | NavRowBadgeSlotId>({
  id,
  props,
  fallback,
  registry = FEATURES,
}: {
  id: Id
  props: SlotProps[Id]
  fallback: ReactNode
  /** Overridable so a test can exercise a real empty or stub registry. */
  registry?: Registry
}) {
  const contributor = contributorFor(id, registry)
  if (!contributor) return <>{fallback}</>
  const shell = shellFor(id, contributor, registry)

  // createElement rather than JSX, and a lowercase binding, because this is a
  // lookup and not a definition: shellFor returns the SAME lazy component out of
  // the module-level cache on every render. Written as `<Shell ... />` it reads
  // to a linter as a component declared inside a render.
  return <Suspense fallback={fallback}>{createElement(shell, { slotProps: props, fallback })}</Suspense>
}

/**
 * Render one section per installed feature that fills `id`, in featureList
 * order, all of them.
 *
 * No `fallback` prop: a multi slot has N contributors and no community answer
 * for any of them, so one shared fallback would either draw the same stand-in N
 * times or stand in for the list rather than for a section. Each contributor
 * gets its own empty Suspense boundary instead, so a section that has not
 * loaded is absent (what a section with no rows looks like here) and one slow
 * chunk cannot hold up the others. A contributor whose loader REJECTS costs
 * that section only, and logs the same E_SLOT_001 line `<Slot>` does.
 */
export function SlotList<Id extends MultiSlotId>({
  id,
  props,
  registry = FEATURES,
}: {
  id: Id
  props: SlotProps[Id]
  /** Overridable so a test can exercise a real empty or stub registry. */
  registry?: Registry
}) {
  const contributors = contributorsFor(id, registry)
  if (contributors.length === 0) return null

  return (
    <>
      {contributors.map((contributor) => (
        // Keyed by feature id, not by index: installing or removing a feature
        // reorders this list, and an index key would remount the wrong section.
        <Fragment key={contributor.featureId}>
          <Suspense fallback={null}>
            {createElement(shellFor(id, contributor, registry), {
              slotProps: props,
              fallback: null,
            })}
          </Suspense>
        </Fragment>
      ))}
    </>
  )
}
