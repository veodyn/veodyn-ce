import { threadSubjectSchema, type ChatThreadSubject } from './wire'

const ID_FIELDS = ['queryId', 'visualizationId', 'dashboardId', 'widgetId'] as const
const TEXT_FIELDS = ['datasetId', 'newKind'] as const

interface SearchReader {
  get(name: string): string | null
}

export function chatAboutHref(subject: ChatThreadSubject): string {
  const params = new URLSearchParams({ about: subject.kind })
  for (const field of [...ID_FIELDS, ...TEXT_FIELDS]) {
    const value = subject[field]
    if (value !== undefined) params.set(field, String(value))
  }
  return `/chat?${params.toString()}`
}

export function subjectFromSearch(search: SearchReader): ChatThreadSubject | null {
  const kind = search.get('about')
  if (kind === null) return null
  const candidate: Record<string, string | number> = { kind }
  for (const field of ID_FIELDS) {
    const value = search.get(field)
    if (value !== null) candidate[field] = /^\d+$/.test(value) ? Number(value) : value
  }
  for (const field of TEXT_FIELDS) {
    const value = search.get(field)
    if (value !== null) candidate[field] = value
  }
  const parsed = threadSubjectSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
