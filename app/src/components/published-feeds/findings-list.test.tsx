import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FindingsList, groupByRule, occurrenceLabel } from './findings-list'
import type { PublishFinding } from '@/types/published-feed'

function finding(over: Partial<PublishFinding> = {}): PublishFinding {
  return {
    ruleId: 'E003',
    severity: 'ERROR',
    title: 'GTFS-rt trip_id does not exist',
    locator: 'entity 0',
    occurrenceCount: 1,
    ...over,
  }
}

describe('occurrenceLabel', () => {
  it('says how many were shown out of the true total when they differ', () => {
    // The whole reason the count is carried. Samples are capped per rule while
    // the total is not, so above that ceiling the locators are a sample and the
    // count is the truth. Showing the sample size alone understates the defect.
    expect(occurrenceLabel(1, 40)).toBe('showing 1 of 40 occurrences')
  })

  it('says the plain count when everything that fired was shown', () => {
    expect(occurrenceLabel(2, 2)).toBe('2 occurrences')
    expect(occurrenceLabel(1, 1)).toBe('1 occurrence')
  })

  it('falls back to what it can see when the attempt predates the count', () => {
    // Stored zero means "this attempt does not know", never "none": a finding
    // exists, so at least one thing happened. Rendering "0 occurrences" over a
    // list of two locators would be a visible contradiction.
    expect(occurrenceLabel(2, 0)).toBe('2 occurrences')
    expect(occurrenceLabel(1, 0)).toBe('1 occurrence')
  })
})

describe('groupByRule', () => {
  it('collapses findings sharing a rule into one row, keeping every locator', () => {
    const rules = groupByRule([finding({ locator: 'entity 0' }), finding({ locator: 'entity 4' })])

    expect(rules).toHaveLength(1)
    expect(rules[0].locators).toEqual(['entity 0', 'entity 4'])
  })

  it('keeps the validator total rather than counting the rows it grouped', () => {
    const rules = groupByRule([
      finding({ locator: 'entity 0', occurrenceCount: 12 }),
      finding({ locator: 'entity 4', occurrenceCount: 12 }),
    ])

    expect(rules[0].occurrenceCount).toBe(12)
    expect(rules[0].locators).toHaveLength(2)
  })

  it('drops empty locators without dropping the finding', () => {
    // A rule that fired but did not say where still has to appear.
    const rules = groupByRule([finding({ locator: '', occurrenceCount: 5 })])

    expect(rules).toHaveLength(1)
    expect(rules[0].locators).toEqual([])
    expect(rules[0].occurrenceCount).toBe(5)
  })
})

describe('FindingsList', () => {
  it('shows the sampled total on the disclosure', () => {
    render(
      <FindingsList
        findings={[
          finding({ locator: 'entity 0', occurrenceCount: 12 }),
          finding({ locator: 'entity 4', occurrenceCount: 12 }),
        ]}
      />
    )

    expect(screen.getByText('showing 2 of 12 occurrences')).toBeInTheDocument()
  })

  it('renders nothing at all when there are no findings', () => {
    const { container } = render(<FindingsList findings={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
