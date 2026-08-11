import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { DynamicForm, jsonFieldError } from './dynamic-form'

afterEach(() => resetStores())

describe('DynamicForm', () => {
  it('associates a dynamically described field with its label', () => {
    renderWithProviders(
      <DynamicForm
        fields={[{ name: 'host', title: 'Host', type: 'text' }]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByLabelText('Host')).toBeInTheDocument()
  })

  it('associates a select field with its label', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <DynamicForm
        fields={[
          {
            name: 'mode',
            title: 'Mode',
            type: 'select',
            options: [{ label: 'Basic', value: 'basic' }],
          },
        ]}
        values={{}}
        onChange={() => {}}
      />
    )

    await user.click(screen.getByLabelText('Mode'))
    expect(await screen.findByRole('option', { name: 'Basic' })).toBeInTheDocument()
  })

  it('renders the configured field types and options', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <DynamicForm
        fields={[
          { name: 'title', title: 'Title', type: 'text', required: true, placeholder: 'A title' },
          { name: 'enabled', title: 'Enabled', type: 'boolean' },
          {
            name: 'mode',
            title: 'Mode',
            type: 'select',
            options: [
              { label: 'Basic', value: 'basic' },
              { label: 'Advanced', value: 'advanced' },
            ],
          },
          { name: 'notes', title: 'Notes', type: 'textarea', placeholder: 'Add notes' },
          { name: 'limit', title: 'Limit', type: 'number' },
        ]}
        values={{ mode: 'basic', enabled: true, limit: 10 }}
        onChange={() => {}}
      />
    )

    expect(screen.getByPlaceholderText('A title')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toBeChecked()

    // Editorial Light renders the select field as a base-ui Select combobox:
    // it resolves to the selected option's label rather than a native
    // <select>'s value, and its options only mount in the DOM once the
    // trigger is opened, so selection is verified by opening it rather than
    // reading `.value` up front.
    const modeTrigger = screen.getByRole('combobox')
    expect(await within(modeTrigger).findByText('Basic')).toBeInTheDocument()
    await user.click(modeTrigger)
    expect(await screen.findByRole('option', { name: 'Advanced' })).toBeInTheDocument()

    expect(screen.getByPlaceholderText('Add notes')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toHaveValue(10)
  })

  // Boolean options saved before these forms could render a checkbox are
  // strings, because the field fell through to a text input. Boolean('false')
  // is true, so reading them naively showed the box ticked for an option that
  // is off.
  it.each([
    ['false', false],
    ['0', false],
    ['no', false],
    ['', false],
    ['true', true],
    ['1', true],
  ])('reads a boolean stored as the string %j as %s', (stored, expected) => {
    renderWithProviders(
      <DynamicForm
        fields={[{ name: 'enabled', title: 'Enabled', type: 'boolean' }]}
        values={{ enabled: stored }}
        onChange={vi.fn()}
      />
    )

    const box = screen.getByRole('checkbox')
    expect(box).toHaveAttribute('aria-checked', String(expected))
  })

  it('shows the required marker without applying native validation', () => {
    renderWithProviders(
      <DynamicForm
        fields={[
          { name: 'title', title: 'Required title', type: 'text', required: true, placeholder: 'Title' },
        ]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Title')).not.toBeRequired()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('passes valid edited values to onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    function ControlledForm() {
      const [values, setValues] = useState<Record<string, unknown>>({ retained: 'yes', title: '' })
      return (
        <DynamicForm
          fields={[{ name: 'title', title: 'Title', type: 'text', placeholder: 'Title' }]}
          values={values}
          onChange={(next) => {
            onChange(next)
            setValues(next)
          }}
        />
      )
    }

    renderWithProviders(<ControlledForm />)
    await user.type(screen.getByPlaceholderText('Title'), 'Hello')

    expect(onChange).toHaveBeenLastCalledWith({ retained: 'yes', title: 'Hello' })
  })

  // Task 2 wrote a cleartext-community-string warning into the NTCIP
  // connector's schema description. Before this, DynamicForm had no way to
  // show a field's description at all, so that warning reached nobody who
  // filled in the form. The exact NTCIP copy is asserted at the page level
  // (new-data-source.test.tsx); this covers the mechanism in isolation.
  it("renders a field's description as help text under its label", () => {
    renderWithProviders(
      <DynamicForm
        fields={[
          {
            name: 'community',
            title: 'SNMP Community String',
            type: 'password',
            description: 'SNMP v1 and v2c send this in plain text on the wire.',
          },
        ]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByText('SNMP v1 and v2c send this in plain text on the wire.')).toBeInTheDocument()
    const input = screen.getByLabelText('SNMP Community String')
    const descId = input.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(String(descId))).toHaveTextContent(
      'SNMP v1 and v2c send this in plain text on the wire.'
    )
  })

  it('renders no description element when a field has none', () => {
    renderWithProviders(
      <DynamicForm
        fields={[{ name: 'host', title: 'Host', type: 'text' }]}
        values={{}}
        onChange={() => {}}
      />
    )

    expect(screen.getByLabelText('Host')).not.toHaveAttribute('aria-describedby')
  })

  describe('a json field', () => {
    it('renders as a textarea, not a single-line input', () => {
      renderWithProviders(
        <DynamicForm
          fields={[{ name: 'default_devices', title: 'Devices (JSON)', type: 'json' }]}
          values={{}}
          onChange={() => {}}
        />
      )

      expect(screen.getByLabelText('Devices (JSON)').tagName).toBe('TEXTAREA')
    })

    it('flags malformed JSON inline as the user types, and clears it once fixed', async () => {
      function ControlledForm() {
        const [values, setValues] = useState<Record<string, unknown>>({})
        return (
          <DynamicForm
            fields={[{ name: 'default_devices', title: 'Devices (JSON)', type: 'json' }]}
            values={values}
            onChange={setValues}
          />
        )
      }

      renderWithProviders(<ControlledForm />)
      const field = screen.getByLabelText('Devices (JSON)')

      // userEvent.type() reads { as a keyboard-descriptor opener, and actual
      // JSON is nothing but braces, so the value is set directly rather than
      // simulated keystroke by keystroke.
      fireEvent.change(field, { target: { value: '{not valid' } })
      expect(await screen.findByRole('alert')).toHaveTextContent(/not valid json/i)
      expect(field).toHaveAttribute('aria-invalid', 'true')

      fireEvent.change(field, { target: { value: '[{"name": "a", "host": "10.0.0.1"}]' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not flag an empty json field: that is a required-field concern, not a shape one', () => {
      renderWithProviders(
        <DynamicForm
          fields={[{ name: 'default_devices', title: 'Devices (JSON)', type: 'json', required: true }]}
          values={{}}
          onChange={() => {}}
        />
      )

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('jsonFieldError', () => {
    it('accepts valid JSON and rejects malformed JSON', () => {
      expect(jsonFieldError('[]')).toBeNull()
      expect(jsonFieldError('')).toBeNull()
      expect(jsonFieldError('{"a": 1}')).toBeNull()
      expect(jsonFieldError('{not valid')).not.toBeNull()
    })

    // A shape error the plan promised would surface on save: JSON that
    // parses fine but is not a device list still has to be caught here,
    // not left to fail later at connection test or query time.
    it('rejects a default_devices value that parses but is not a non-empty list of objects', () => {
      expect(jsonFieldError('{}', 'default_devices')).not.toBeNull()
      expect(jsonFieldError('null', 'default_devices')).not.toBeNull()
      expect(jsonFieldError('[]', 'default_devices')).not.toBeNull()
      expect(jsonFieldError('"a string"', 'default_devices')).not.toBeNull()
      expect(jsonFieldError('42', 'default_devices')).not.toBeNull()
      expect(jsonFieldError('[1, 2, 3]', 'default_devices')).not.toBeNull()
    })

    it('accepts a valid default_devices list', () => {
      expect(
        jsonFieldError('[{"name": "I-5 NB MP12", "host": "10.0.1.20"}]', 'default_devices')
      ).toBeNull()
    })

    it('does not apply the default_devices shape check to other json fields', () => {
      // A JSON field with a different name (e.g. gtfs_realtime's route
      // label map, a plain object) must not be forced into the array shape.
      expect(jsonFieldError('{"1": "Line 1"}', 'route_labels')).toBeNull()
    })
  })
})
