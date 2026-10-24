import { getVisualization, type ReadinessContext } from '@veodyn/viz'

export const NOTICE_MAX_CHARS = 300

export function readinessNotice(
  type: string,
  options: Record<string, unknown>,
  context: ReadinessContext
): string | undefined {
  const check = getVisualization(type)?.readiness
  if (!check) return undefined
  try {
    const message = check(options, context)
    return message ? message.slice(0, NOTICE_MAX_CHARS) : undefined
  } catch (error) {
    console.error(`Visualization plugin "${type}" threw from readiness()`, error)
    return undefined
  }
}
