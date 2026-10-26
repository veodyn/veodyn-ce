import { describe, expect, it } from 'vitest'
import type { ChatThreadSubject } from './wire'
import { chatAboutHref, subjectFromSearch } from './subject-href'

const SUBJECTS: ChatThreadSubject[] = [
  { kind: 'query', queryId: 7 },
  { kind: 'visualization', queryId: 7, visualizationId: 12 },
  { kind: 'dashboard', dashboardId: 4 },
  { kind: 'widget', dashboardId: 4, widgetId: 21 },
  { kind: 'dataset', datasetId: 'warehouse.sample speeds&more' },
  { kind: 'new', newKind: 'kpi' },
]

function searchOf(href: string): URLSearchParams {
  return new URL(href, 'http://app.test').searchParams
}

describe('chatAboutHref', () => {
  it('points the chat home at the subject without naming a thread', () => {
    expect(chatAboutHref({ kind: 'widget', dashboardId: 4, widgetId: 21 })).toBe(
      '/chat?about=widget&dashboardId=4&widgetId=21'
    )
    expect(chatAboutHref({ kind: 'new', newKind: 'query' })).toBe('/chat?about=new&newKind=query')
  })

  it.each(SUBJECTS)('reads back the $kind subject it wrote', (subject) => {
    expect(subjectFromSearch(searchOf(chatAboutHref(subject)))).toEqual(subject)
  })
})

describe('subjectFromSearch', () => {
  it('is no subject on the plain chat home', () => {
    expect(subjectFromSearch(new URLSearchParams())).toBeNull()
  })

  it.each([
    'about=query',
    'about=query&queryId=abc',
    'about=query&queryId=-3',
    'about=widget&dashboardId=4',
    'about=new&newKind=spreadsheet',
    'about=planet&queryId=7',
    'queryId=7',
  ])('ignores a subject it cannot trust: %s', (search) => {
    expect(subjectFromSearch(new URLSearchParams(search))).toBeNull()
  })

  it('ignores parameters that are not part of a subject', () => {
    expect(subjectFromSearch(new URLSearchParams('about=query&queryId=7&utm=x'))).toEqual({
      kind: 'query',
      queryId: 7,
    })
  })
})
