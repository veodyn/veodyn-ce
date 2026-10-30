import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resultTooLargeMessage } from '@/lib/chat/result-cap'
import type { RunView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { ResponseTooLargeError } from '@/services/capped-body'
import { RunCard } from './run-card'

const FAILED_RUN: RunView = {
  callId: 'a1',
  dataSourceId: 5,
  purpose: 'MCA resources',
  sql: 'SELECT * FROM resources',
  vizChoiceId: 'table',
  status: 'failed',
  rowCount: null,
  durationMs: null,
  error: null,
}

const TOO_LARGE = resultTooLargeMessage(new ResponseTooLargeError(8_400_000, 8_388_608, null))

function renderCard(overrides: Partial<React.ComponentProps<typeof RunCard>> = {}) {
  renderWithProviders(<RunCard run={FAILED_RUN} selected={false} onSelect={vi.fn()} onRerun={vi.fn()} {...overrides} />)
}

describe('a run card whose result was over the byte cap', () => {
  it('says_the_result_was_too_large_instead_of_that_the_query_failed', () => {
    renderCard({ error: TOO_LARGE })
    expect(screen.getByText('Result too large to load')).toBeInTheDocument()
    expect(screen.queryByText('The query failed')).not.toBeInTheDocument()
    expect(screen.getByText(/over the 8 MB/)).toBeInTheDocument()
    expect(screen.queryByText(TOO_LARGE)).not.toBeInTheDocument()
  })

  it('reads_the_same_state_from_a_stored_run_error_after_a_reload', () => {
    renderCard({ run: { ...FAILED_RUN, error: TOO_LARGE } })
    expect(screen.getByText('Result too large to load')).toBeInTheDocument()
  })

  it('an_ordinary_failure_keeps_the_generic_state', () => {
    renderCard({ error: 'Syntax error near FROM' })
    expect(screen.getByText('The query failed')).toBeInTheDocument()
    expect(screen.getByText('Syntax error near FROM')).toBeInTheDocument()
    expect(screen.queryByText('Result too large to load')).not.toBeInTheDocument()
  })
})
