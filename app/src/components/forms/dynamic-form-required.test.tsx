import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { DynamicForm } from './dynamic-form'

afterEach(() => resetStores())

describe('DynamicForm required marking', () => {
  it('marks a required field with the label marker and native validation', () => {
    renderWithProviders(
      <DynamicForm
        fields={[
          { name: 'title', title: 'Required title', type: 'text', required: true, placeholder: 'Title' },
        ]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('Required title').querySelector('[data-slot="required-marker"]')).not.toBeNull()
    const input = screen.getByPlaceholderText('Title')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-required', 'true')
  })

  it('leaves an optional field without a marker or native validation', () => {
    renderWithProviders(
      <DynamicForm
        fields={[{ name: 'title', title: 'Optional title', type: 'text', placeholder: 'Title' }]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('Optional title').querySelector('[data-slot="required-marker"]')).toBeNull()
    const input = screen.getByPlaceholderText('Title')
    expect(input).not.toBeRequired()
    expect(input).not.toHaveAttribute('aria-required')
  })

  it('marks a required select and boolean field, with aria-required on the select trigger', () => {
    renderWithProviders(
      <DynamicForm
        fields={[
          {
            name: 'mode',
            title: 'Mode',
            type: 'select',
            required: true,
            options: [{ label: 'Basic', value: 'basic' }],
          },
          { name: 'enabled', title: 'Enabled', type: 'boolean', required: true },
        ]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('Mode').querySelector('[data-slot="required-marker"]')).not.toBeNull()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-required', 'true')

    const enabledTexts = screen.getAllByText('Enabled')
    expect(enabledTexts.some((el) => el.querySelector('[data-slot="required-marker"]'))).toBe(true)
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-required', 'true')
  })
})
