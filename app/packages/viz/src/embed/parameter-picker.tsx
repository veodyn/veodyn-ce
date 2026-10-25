'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  normalizePublicParameterValues,
  publicParameterValuesUrl,
  type PublicDashboardParameter,
  type PublicParameterValues,
} from '../lib/public-dashboard'
import { useVeodyn } from './veodyn-context'

export const PICKER_DEBOUNCE_MS = 200

interface ParameterPickerProps {
  dashboardToken: string
  widgetId: number
  parameter: PublicDashboardParameter
  value: string | undefined
  onChange: (value: string) => void
}

async function fetchValues(url: string, signal: AbortSignal): Promise<PublicParameterValues> {
  const response = await fetch(url, { credentials: 'omit', signal, headers: { accept: 'application/json' } })
  if (!response.ok) return { values: [], truncated: false }
  return normalizePublicParameterValues(await response.json().catch(() => null)) ?? { values: [], truncated: false }
}

function useDebounced(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

export function ParameterPicker({ dashboardToken, widgetId, parameter, value, onChange }: ParameterPickerProps) {
  const { baseUrl } = useVeodyn()
  const id = useId()
  const listId = `${id}-options`
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const prefix = useDebounced(text, PICKER_DEBOUNCE_MS)
  const url = publicParameterValuesUrl(baseUrl, dashboardToken, widgetId, parameter.name, prefix)
  const { data } = useQuery({
    queryKey: ['veodyn-public-parameter-values', url],
    queryFn: ({ signal }) => fetchValues(url, signal),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  })
  const options = data?.values ?? []
  const current = value ?? parameter.defaultValue ?? ''
  const { data: currentData } = useQuery({
    queryKey: ['veodyn-public-parameter-values', publicParameterValuesUrl(baseUrl, dashboardToken, widgetId, parameter.name, current)],
    queryFn: ({ signal }) =>
      fetchValues(publicParameterValuesUrl(baseUrl, dashboardToken, widgetId, parameter.name, current), signal),
    enabled: current !== '',
    staleTime: 60_000,
    retry: false,
  })
  const currentLabel = currentData?.values.find((option) => option.value === current)?.name ?? current

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setText('')
    setOpen(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div data-veodyn-part="parameter" data-veodyn-parameter={parameter.name}>
      <Label htmlFor={id}>{parameter.title}</Label>
      <Input
        id={id}
        data-veodyn-part="parameter-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={currentLabel || 'Search'}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {currentLabel ? <output data-veodyn-part="parameter-value">{currentLabel}</output> : null}
      <ul id={listId} role="listbox" aria-label={parameter.title} data-veodyn-part="parameter-options" hidden={!open}>
        {options.map((option, index) => (
          <li
            key={option.value}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            data-veodyn-part="parameter-option"
            onMouseDown={(event) => {
              event.preventDefault()
              choose(index)
            }}
          >
            {option.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
