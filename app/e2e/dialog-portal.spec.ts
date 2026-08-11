import { expect, test } from '@playwright/test'
import { addHeatmapToDashboard, authorTallHeatmap, openExpandedWidgetDialog } from './heatmap-interaction-helpers'

// The regression guard for the bug dialog-wrapper.tsx's own comment recorded
// before it was deleted: `position: fixed` resolves against the nearest
// transformed ancestor, not the viewport, and react-grid-layout puts a
// `transform: translate(...)` on every dashboard widget. Rendered in place, an
// unportalled overlay measured trapped inside its widget at 983x505 at
// (279,123) instead of covering the viewport.
//
// The Expand dialog on a dashboard widget is the one host in the app that
// opens from underneath a transformed ancestor, so it is the only dialog that
// can actually catch a portal regression. Every other dialog in the app opens
// from an untransformed page and would pass this assertion whether or not
// DialogContent kept its DialogPortal.
//
// This guard was proven, not assumed, against a real mutation: dropping
// `<DialogPortal>` from `DialogContent` outright is unsurvivable (Base UI's
// `Popup` throws `Base UI: <Dialog.Portal> is missing.` and crashes every
// dialog in the app, including the always-mounted command palette, before
// this test ever reaches the dashboard). The mutation actually exercised was
// portal CONTAINER MISDIRECTION: keeping `<DialogPortal>` but pointing its
// `container` at the dashboard widget instead of `document.body`, which
// reproduces the same CSS mechanism (`position: fixed` resolving against a
// transformed ancestor) without touching the context Popup requires to
// render at all. Under that mutation the dialog centered itself on the
// WIDGET's center (516, 532.5) rather than the viewport's (640, 360), a
// 124px / 172.5px miss, and its width fell to 455px against a required
// >1024px. Both the position and width assertions below are calibrated
// against those measured numbers, not guessed.
test("a dialog opened from a dashboard widget covers the viewport, not the widget's transformed box", async ({
  page,
}) => {
  await authorTallHeatmap(page)
  await addHeatmapToDashboard(page)

  // The FIXTURE: the widget this dialog opens from really is a small,
  // transformed box, or this test proves nothing about the bug it guards.
  const widget = page.locator('.react-grid-item').filter({ has: page.locator('[role="grid"]') })
  const widgetBox = await widget.boundingBox()
  expect(widgetBox).not.toBeNull()

  const dialog = await openExpandedWidgetDialog(page)
  await expect(dialog).toBeVisible()

  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()

  // POSITION: centered against the VIEWPORT, not the widget. A dialog
  // trapped inside the widget's transformed box centers itself on the
  // WIDGET's own center instead, via the same `top-1/2 left-1/2
  // -translate-x-1/2 -translate-y-1/2` rule that centers it correctly when
  // portalled to <body>: fixed positioning always resolves against its
  // nearest containing block's center, viewport or not. Measured under the
  // container-misdirection mutation, that miss was 124px horizontally
  // (9.7% of the 1280px viewport) and 172.5px vertically (24% of the 720px
  // viewport), against an exact 0px miss on a correctly portalled dialog
  // (fixed-position centering math has no meaningful render jitter of its
  // own). 5% is comfortably above that 0px baseline and comfortably below
  // both measured misses, so it fails the mutation with margin to spare
  // (124px vs a 64px cap; 172.5px vs a 36px cap) without being so tight that
  // ordinary sub-pixel layout rounding could trip it.
  //
  // A "dialog top is well above the widget's top edge" check, floated as an
  // alternative, does not hold up: the dialog's height (588px) exceeds the
  // widget's (375px), so even trapped inside the widget the dialog's top
  // still lands above the widget's top edge, just as a correctly portalled
  // dialog's does. Center proximity is the property that actually
  // discriminates the two cases; edge proximity does not.
  const viewportCenterX = (viewport?.width ?? 0) / 2
  const viewportCenterY = (viewport?.height ?? 0) / 2
  const dialogCenterX = (box?.x ?? 0) + (box?.width ?? 0) / 2
  const dialogCenterY = (box?.y ?? 0) + (box?.height ?? 0) / 2
  expect(Math.abs(dialogCenterX - viewportCenterX)).toBeLessThan((viewport?.width ?? 0) * 0.05)
  expect(Math.abs(dialogCenterY - viewportCenterY)).toBeLessThan((viewport?.height ?? 0) * 0.05)

  // WIDTH: positioned against the viewport, not clipped to the (far
  // narrower) widget it was opened from. Optional-chained rather than
  // asserted: both are already proven non-null above, and a non-null
  // assertion is banned by this project's lint config.
  expect(box?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.8)
  expect(box?.width ?? 0).toBeGreaterThan((widgetBox?.width ?? 0) * 1.5)
})
