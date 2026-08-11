import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { mockDataReady } from '@/stores/mock-data-store'
import { server } from './msw/server'

// CI runners are much slower than local; the default 1s findBy timeout flakes
// on components that wait on chained MSW fetches (e.g. query-backed params).
configure({ asyncUtilTimeout: 10_000 })

// Settle the mock store's contributed collections before any test runs.
//
// They arrive through a feature descriptor's loader now, so they land some
// number of ticks after the store module is evaluated. Measured: the whole
// suite passes without this line, because every file that needs the fixtures
// seeds them itself in a beforeEach. What this stops is the ORDERING: an
// unawaited hydration can resolve in the middle of a file and overwrite a
// `setState({ reports: ... })` a test just made, which is a failure that
// depends on how loaded the runner is and would show up as one flaky suite on
// CI rather than as anything reproducible here.
//
// Deliberately NOT what makes those collections safe to read. They are `[]`
// before this resolves and stay `[]` in a build with no KPI feature, and
// nothing in the app waits on this promise. See stores/mock-data-hydration.ts.
beforeAll(() => mockDataReady)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// jsdom does not implement ResizeObserver or scrollIntoView, and cmdk (the
// Command primitive's underlying library) uses both internally to track list
// dimensions and scroll the active item into view. Every suite that renders a
// cmdk-based component needs these, so they are stubbed globally here rather
// than per-file. Guarded on `typeof Element` because this setup file also
// loads for the `@vitest-environment node` API route suites, where there is
// no DOM and `Element` is not a global.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // Same story for IntersectionObserver, which jsdom also does not implement:
  // the message-scroller primitive uses it to track which turns are on screen,
  // so it decides whether to follow a streaming reply. Nothing observes
  // anything in jsdom (there is no layout to observe), so the scroller's
  // positioning is not under test here; what is under test is that the
  // components render and mark the right rows as anchors.
  global.IntersectionObserver = class {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  if (typeof Element !== 'undefined') {
    Element.prototype.scrollIntoView = () => {}

    // react-resizable-panels (the `resizable` primitive) focuses whichever
    // separator a pointerdown lands "on", computed from that separator's OWN
    // getBoundingClientRect (not, as it first appears, some padded gap
    // between its neighbouring panels: that derived-gap path only runs when
    // there is no real Separator element, and every `resizable.tsx` split
    // renders one). jsdom never runs layout, so every element's rect is 0x0
    // at the origin by default: the separator's rect then sits exactly on
    // top of every other element's, so a click ANYWHERE on a page with a
    // resizable split gets stolen by the splitter instead of reaching its
    // real target. Giving `data-panel` and `data-separator` elements a real,
    // non-overlapping rect confines that hit-testing to the splitter itself.
    // Nothing else on the page is touched: every other element keeps
    // jsdom's usual 0x0 rect, exactly as before this existed.
    const realGetBoundingClientRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const height = 300
      if (this.hasAttribute('data-panel')) {
        const panels = Array.from(this.parentElement?.children ?? []).filter((el) =>
          el.hasAttribute('data-panel')
        )
        const index = panels.indexOf(this)
        const top = index * height
        return {
          width: 800,
          height,
          top,
          bottom: top + height,
          left: 0,
          right: 800,
          x: 0,
          y: top,
          toJSON() {
            return this
          },
        } as DOMRect
      }
      if (this.hasAttribute('data-separator')) {
        const siblings = Array.from(this.parentElement?.children ?? [])
        const panelsBefore = siblings
          .slice(0, siblings.indexOf(this))
          .filter((el) => el.hasAttribute('data-panel')).length
        const top = panelsBefore * height
        return {
          width: 800,
          height: 4,
          top,
          bottom: top + 4,
          left: 0,
          right: 800,
          x: 0,
          y: top,
          toJSON() {
            return this
          },
        } as DOMRect
      }
      return realGetBoundingClientRect.call(this)
    }
  }

  // Deliberately NO global window.matchMedia stub here, though jsdom does not
  // implement one and it looks like an obvious gap to fill.
  //
  // use-reduced-motion.ts reads an absent matchMedia as "prefers reduced
  // motion", on purpose, so motion never starts on a surface that cannot report
  // the preference. Every count-up in the suite therefore renders its final
  // value immediately. Adding a stub that answers `matches: false` flips that:
  // the animations start, and assertions that look for the settled number
  // ("82%") find the first frame instead. Tried on 2026-07-28 and it broke
  // three suites (kpi-scorecard, the KPI detail page, the domain hub).
  //
  // A test that needs a media query installs its own stub for its own case,
  // which is also the only way to model preferring dark.
})
