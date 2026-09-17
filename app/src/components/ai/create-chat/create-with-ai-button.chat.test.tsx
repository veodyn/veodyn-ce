import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { CreateWithAiButton } from './create-with-ai-button'

describe('CreateWithAiButton and the data chat', () => {
  it('links to the chat when it is on', () => {
    renderWithProviders(<CreateWithAiButton kind="query" />, { config: { ai: { enabled: true, chat: true } } })
    expect(screen.getByRole('link', { name: 'Ask in chat' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('button', { name: 'Create with AI' })).toBeInTheDocument()
  })

  it('offers no link when chat is off', () => {
    renderWithProviders(<CreateWithAiButton kind="query" />, { config: { ai: { enabled: true, chat: false } } })
    expect(screen.queryByRole('link', { name: 'Ask in chat' })).not.toBeInTheDocument()
  })
})
