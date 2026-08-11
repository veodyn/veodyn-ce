// Elements carrying this class have their text recorded in replays. Everything
// else is masked.
//
// Inverted from warpdrive on purpose. warpdrive unmasks everything because its
// users are internal staff who already see the whole CRM. veodyn renders tenant
// data in every chart and table, so a replay shows WHERE someone got stuck and
// never WHAT they were looking at.
export const UNMASK_CLASS = 'ph-unmask'

/**
 * Mask every text node, except inside a subtree marked as app chrome.
 *
 * posthog-js 1.409.5 has no `unmaskTextSelector` (checked against
 * @posthog/types 1.399.0: the recording config exposes maskTextClass,
 * maskTextSelector, maskTextFn and the maskInput family, and nothing that
 * unmasks). Doing this in `maskTextFn` is what makes "mask by default, unmask
 * chrome" expressible at all, and it is more precise than a selector would be
 * because it can walk ancestors.
 *
 * Masked text keeps its LENGTH and nothing else, so a replay still shows a
 * table with the right shape and column widths while every value is stars.
 */
function maskTextFn(text: string, element?: HTMLElement): string {
  // No element means rrweb could not attribute this text to a node. Unprovable
  // is treated as unsafe.
  if (!element) return '*'.repeat(text.length)
  if (element.closest(`.${UNMASK_CLASS}`) !== null) return text
  return '*'.repeat(text.length)
}

// Passed to posthog.init as `session_recording`.
export const sessionRecordingOptions = {
  maskAllInputs: true,
  // Route every text node through maskTextFn, which decides per element.
  maskTextSelector: '*',
  maskTextFn,
} as const
