import { describe, expect, it } from 'vitest'
import { NEUTRAL_CONFIG, toClientConfig, veodynConfigSchema } from './config-schema'
import { applyEnvOverrides } from './config'

describe('the retired ai.chat key', () => {
  it('is not sent to the client', () => {
    expect(toClientConfig(NEUTRAL_CONFIG).ai).toEqual({ enabled: false })
  })

  it('still loads when an instance config sets it', () => {
    const config = veodynConfigSchema.parse({ ai: { enabled: true, endpoint: 'https://ai.example', chat: 'true' } })
    expect(toClientConfig(config).ai).toEqual({ enabled: true })
  })

  it('loads without ai.enabled, which it used to refuse', () => {
    expect(veodynConfigSchema.safeParse({ ai: { chat: true } }).success).toBe(true)
  })

  it('is read from the environment without effect on the client', () => {
    const env = { VEODYN_AI__TOKEN_SECRET: 'secret', VEODYN_AI__CHAT: 'true' } as unknown as NodeJS.ProcessEnv
    expect(applyEnvOverrides({}, env)).toEqual({ ai: { chat: true } })
  })
})
