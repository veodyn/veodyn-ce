import { describe, expect, it } from 'vitest'
import { sessionRecordingOptions, UNMASK_CLASS } from './replayMasking'

describe('sessionRecordingOptions', () => {
  it('masks every input by default', () => {
    expect(sessionRecordingOptions.maskAllInputs).toBe(true)
  })

  it('routes every text node through the mask function', () => {
    expect(sessionRecordingOptions.maskTextSelector).toBe('*')
  })
})

describe('maskTextFn', () => {
  const mask = sessionRecordingOptions.maskTextFn

  it('masks text with no element, since it cannot be proven safe', () => {
    expect(mask('91234', undefined)).toBe('*****')
  })

  it('masks a chart value, preserving only its length', () => {
    const cell = document.createElement('td')
    cell.textContent = '91234'
    expect(mask('91234', cell)).toBe('*****')
  })

  it('passes through text inside an unmasked chrome element', () => {
    const nav = document.createElement('nav')
    nav.className = UNMASK_CLASS
    expect(mask('Dashboards', nav)).toBe('Dashboards')
  })

  it('passes through text nested below an unmasked ancestor', () => {
    const nav = document.createElement('nav')
    nav.className = UNMASK_CLASS
    const label = document.createElement('span')
    nav.appendChild(label)
    expect(mask('Settings', label)).toBe('Settings')
  })

  it('masks a sibling that is not under the unmask class', () => {
    const wrapper = document.createElement('div')
    const nav = document.createElement('nav')
    nav.className = UNMASK_CLASS
    const chart = document.createElement('div')
    wrapper.append(nav, chart)
    expect(mask('91234', chart)).toBe('*****')
  })
})
