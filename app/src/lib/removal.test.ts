import { describe, expect, it } from 'vitest'
import { isRecoverable, removalCopy, type LibraryKind } from './removal'

const ALL: LibraryKind[] = ['query', 'dashboard', 'kpi', 'report', 'snippet']

describe('removalCopy', () => {
  it('names the verb the backend actually performs', () => {
    expect(removalCopy('query', 'Weekly revenue').verb).toBe('Archive')
    expect(removalCopy('dashboard', 'Ops overview').verb).toBe('Archive')
    expect(removalCopy('kpi', 'On-time rate').verb).toBe('Delete')
    expect(removalCopy('report', 'Q3 board pack').verb).toBe('Delete')
    expect(removalCopy('snippet', 'last7d').verb).toBe('Delete')
  })

  it('quotes the object by name', () => {
    expect(removalCopy('kpi', 'On-time rate').title).toBe('Delete "On-time rate"?')
    expect(removalCopy('query', 'Weekly revenue').title).toBe('Archive "Weekly revenue"?')
  })

  it('falls back to the noun rather than quoting nothing', () => {
    // The dialog stays mounted for a frame after the pending item clears, and
    // 'Delete ""?' is what a naive template renders there.
    expect(removalCopy('kpi', null).title).toBe('Delete KPI?')
    expect(removalCopy('query', undefined).title).toBe('Archive query?')
    expect(removalCopy('snippet', '').title).toBe('Delete snippet?')
  })

  it.each(ALL)('says something concrete about what %s removal costs', (kind) => {
    const { description } = removalCopy(kind, 'Something')
    expect(description.length).toBeGreaterThan(30)
    expect(description).toMatch(/\.$/)
  })

  it('promises restoration only where restoration exists', () => {
    for (const kind of ALL) {
      const { description } = removalCopy(kind, 'Something')
      // Asserted against isRecoverable rather than against a hardcoded list, so
      // a type whose semantic changes cannot keep copy that now lies.
      expect(/restored? .*from the Archive tab/i.test(description)).toBe(isRecoverable(kind))
      expect(/cannot be undone/i.test(description)).toBe(!isRecoverable(kind))
    }
  })

  it('warns about all three things archiving a query destroys', () => {
    // Query.archive does exactly three irreversible things: deletes every alert
    // on the query, clears its schedule, and deletes every widget built on its
    // visualizations. Unarchiving restores none of them. The old one-click
    // Archive menu item mentioned none of it, and the first version of this
    // copy named only two of the three, so each is asserted separately rather
    // than as one "warns the user" case that a partial sentence would satisfy.
    const { description } = removalCopy('query', 'Weekly revenue')
    expect(description).toMatch(/alerts/i)
    expect(description).toMatch(/schedule/i)
    expect(description).toMatch(/widgets/i)
    expect(description).toMatch(/do not come back/i)
  })

  it('warns that removal breaks a public link where one can exist', () => {
    expect(removalCopy('dashboard', 'Ops overview').description).toMatch(/public link/i)
    expect(removalCopy('report', 'Q3 board pack').description).toMatch(/public link/i)
  })
})

describe('isRecoverable', () => {
  it('matches what the two backends do', () => {
    // Redash soft-archives these two: DELETE /api/queries/:id sets is_archived,
    // as does DELETE /api/dashboards/:id.
    expect(isRecoverable('query')).toBe(true)
    expect(isRecoverable('dashboard')).toBe(true)
    // veodyn-api hard-deletes the first two rows; Redash hard-deletes snippets.
    expect(isRecoverable('kpi')).toBe(false)
    expect(isRecoverable('report')).toBe(false)
    expect(isRecoverable('snippet')).toBe(false)
  })
})
