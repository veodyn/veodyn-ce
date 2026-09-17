import { describe, expect, it } from 'vitest'
import { NEUTRAL_CONFIG, toClientConfig, veodynConfigSchema } from './config-schema'
import { applyEnvOverrides } from './config'

describe('ai.chat', () => {
  it('is off by default and reaches the client', () => {
    expect(NEUTRAL_CONFIG.ai.chat).toBe(false)
    expect(toClientConfig(NEUTRAL_CONFIG).ai).toEqual({ enabled: false, chat: false })
  })

  it('turns on beside ai.enabled', () => {
    const config = veodynConfigSchema.parse({ ai: { enabled: true, endpoint: 'https://ai.example', chat: 'true' } })
    expect(toClientConfig(config).ai).toEqual({ enabled: true, chat: true })
  })

  it('is refused without ai.enabled', () => {
    expect(veodynConfigSchema.safeParse({ ai: { chat: true } }).success).toBe(false)
  })

  it('never reads the token secret as config', () => {
    const env = { VEODYN_AI__TOKEN_SECRET: 'secret', VEODYN_AI__CHAT: 'true' } as unknown as NodeJS.ProcessEnv
    expect(applyEnvOverrides({}, env)).toEqual({ ai: { chat: true } })
  })
})
