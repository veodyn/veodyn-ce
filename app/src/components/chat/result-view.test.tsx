import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultView } from '@/components/chat/result-view'
import { renderWithProviders } from '@/test/utils'

describe('ResultView', () => {
  it('shows an empty state rather than drawing a result with no rows', () => {
    renderWithProviders(
      <ResultView vizChoiceId="table" data={{ columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: [] }} />
    )
    expect(screen.getByText('The query returned no rows.')).toBeInTheDocument()
  })
})
