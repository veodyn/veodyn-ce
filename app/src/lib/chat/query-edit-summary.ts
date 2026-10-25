import type { QueryChanges } from './query-changes'
import { parameterChanges } from './query-parameter-diff'
import type { ChatQuerySnapshot } from './tool-results-query'

export interface FieldChange {
  field: string
  label: string
  before: string
  after: string
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

const INTERVAL_LABELS: Record<number, string> = {
  60: 'every minute',
  300: 'every 5 minutes',
  600: 'every 10 minutes',
  900: 'every 15 minutes',
  1800: 'every 30 minutes',
  3600: 'every hour',
  7200: 'every 2 hours',
  10800: 'every 3 hours',
  21600: 'every 6 hours',
  43200: 'every 12 hours',
  86400: 'every day',
  604800: 'every week',
}

type Schedule = NonNullable<ChatQuerySnapshot['schedule']>

const NONE = 'None'
const MAX_DIFF_CELLS = 250_000

export function describeSchedule(schedule: Schedule | null | undefined): string {
  if (!schedule || !schedule.interval) return NONE
  const every = INTERVAL_LABELS[Number(schedule.interval)] ?? `every ${schedule.interval} seconds`
  const parts = [every]
  if (schedule.dayOfWeek) parts.push(`on ${schedule.dayOfWeek}`)
  if (schedule.time) parts.push(`at ${schedule.time}`)
  if (schedule.until) parts.push(`until ${schedule.until}`)
  return parts.join(' ')
}

function listOf(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : NONE
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const left = before.split('\n')
  const right = after.split('\n')
  if (left.length * right.length > MAX_DIFF_CELLS) {
    return [
      ...left.map((text): DiffLine => ({ kind: 'removed', text })),
      ...right.map((text): DiffLine => ({ kind: 'added', text })),
    ]
  }
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ kind: 'same', text: left[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'removed', text: left[i++] })
    } else {
      lines.push({ kind: 'added', text: right[j++] })
    }
  }
  while (i < left.length) lines.push({ kind: 'removed', text: left[i++] })
  while (j < right.length) lines.push({ kind: 'added', text: right[j++] })
  return lines
}

export function fieldChanges(snapshot: ChatQuerySnapshot, changes: QueryChanges): FieldChange[] {
  const rows: FieldChange[] = []
  if (changes.name !== undefined) rows.push({ field: 'name', label: 'Name', before: snapshot.name, after: changes.name })
  if (changes.description !== undefined) {
    rows.push({
      field: 'description',
      label: 'Description',
      before: snapshot.description || NONE,
      after: changes.description || NONE,
    })
  }
  if (changes.dataSourceId !== undefined) {
    rows.push({
      field: 'dataSourceId',
      label: 'Data source',
      before: `Data source ${snapshot.dataSourceId}`,
      after: `Data source ${changes.dataSourceId}`,
    })
  }
  if (changes.parameters !== undefined) rows.push(...parameterChanges(snapshot.parameters, changes.parameters))
  if (changes.tags !== undefined) {
    rows.push({ field: 'tags', label: 'Tags', before: listOf(snapshot.tags), after: listOf(changes.tags) })
  }
  if (changes.schedule !== undefined) {
    rows.push({
      field: 'schedule',
      label: 'Schedule',
      before: describeSchedule(snapshot.schedule),
      after: describeSchedule(changes.schedule),
    })
  }
  if (changes.isDraft !== undefined) {
    rows.push({
      field: 'isDraft',
      label: 'Status',
      before: snapshot.isDraft ? 'Draft' : 'Published',
      after: changes.isDraft ? 'Draft' : 'Published',
    })
  }
  return rows
}
