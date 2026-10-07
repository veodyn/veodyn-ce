import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from '@/components/config/config-provider'
import { NEUTRAL_CONFIG, toClientConfig, type ClientConfig } from '@/lib/config-schema'
import { Slot, SlotList } from './slots'
import { featureWith } from './slots.test-helpers'
import type { FeatureDescriptor, SlotContributions } from './types'

const MESSAGES_OFF: ClientConfig = toClientConfig(NEUTRAL_CONFIG)
const MESSAGES_ON: ClientConfig = { ...MESSAGES_OFF, messages: { enabled: true } }

function messagesFeature(slots: SlotContributions): FeatureDescriptor {
  return { ...featureWith('messages', slots), enabled: (config) => config.messages.enabled }
}

function contributed(label: string) {
  return vi.fn(async () => ({ default: () => <span>{label}</span> }))
}

describe('a slot filled by a feature the instance has switched off', () => {
  it('renders the fallback and never enters the loader of a single slot', async () => {
    const reviewQueue = contributed('review queue')
    const registry = { messages: messagesFeature({ 'home.reviewQueue': reviewQueue }) }

    render(
      <ConfigProvider value={MESSAGES_OFF}>
        <Slot id="home.reviewQueue" props={{}} fallback={<span>nothing to review</span>} registry={registry} />
      </ConfigProvider>
    )

    expect(screen.getByText('nothing to review')).toBeInTheDocument()
    await Promise.resolve()
    expect(reviewQueue).not.toHaveBeenCalled()
  })

  it('leaves the section out of a multi slot and never enters its loader', async () => {
    const section = contributed('messages section')
    const registry = { messages: messagesFeature({ 'profile.section': section }) }

    render(
      <ConfigProvider value={MESSAGES_OFF}>
        <SlotList id="profile.section" props={{ userId: 1 }} registry={registry} />
      </ConfigProvider>
    )

    await Promise.resolve()
    expect(section).not.toHaveBeenCalled()
    expect(screen.queryByText('messages section')).not.toBeInTheDocument()
  })

  it('still renders the contribution once the instance switches the feature on', async () => {
    const reviewQueue = contributed('review queue')
    const registry = { messages: messagesFeature({ 'home.reviewQueue': reviewQueue }) }

    render(
      <ConfigProvider value={MESSAGES_ON}>
        <Slot id="home.reviewQueue" props={{}} fallback={<span>nothing to review</span>} registry={registry} />
      </ConfigProvider>
    )

    expect(await screen.findByText('review queue')).toBeInTheDocument()
    await waitFor(() => expect(reviewQueue).toHaveBeenCalledTimes(1))
  })
})
