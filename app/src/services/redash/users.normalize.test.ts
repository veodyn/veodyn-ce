// What normalizeUser fills in, and the two fields where the default is a
// decision rather than a formality.
//
// It rebuilds the row field by field, so anything it does not name never
// reaches the users table. `groups` is the field most likely to break silently:
// some Redash versions serialize a membership as a bare id and others as an
// object, and an unconverted object turns every group check into a comparison
// against NaN, which quietly answers "not a member".
import { describe, expect, it } from 'vitest'
import { normalizeUser } from './users'

type RawUser = Parameters<typeof normalizeUser>[0]

const RAW: RawUser = {
  id: 4,
  name: 'Ada',
  email: 'ada@example.com',
  profile_image_url: 'https://example.com/a.png',
  groups: [1, 2],
  api_key: 'k-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  is_disabled: false,
  is_invitation_pending: false,
  active_at: '2026-01-03T00:00:00Z',
  is_email_verified: true,
  auth_type: 'password',
}

/** The minimum Redash guarantees: everything else is optional on the wire. */
const MINIMAL: RawUser = { id: 4, name: 'Ada', email: 'ada@example.com', groups: [] }

describe('normalizeUser keeps what the payload carries', () => {
  it('passes a full row through unchanged', () => {
    expect(normalizeUser(RAW)).toEqual({ ...RAW, invite_link: undefined })
  })

  it('keeps the group memberships', () => {
    expect(normalizeUser({ ...RAW, groups: [1, 2, 7] }).groups).toEqual([1, 2, 7])
  })

  // The version difference. An object membership has to become its id, or the
  // admin checks that read `groups.includes(adminGroupId)` all answer false.
  it('flattens object group memberships to their ids', () => {
    expect(normalizeUser({ ...RAW, groups: [{ id: 1 }, { id: 2 }] }).groups).toEqual([1, 2])
  })

  it('flattens a mixed groups array', () => {
    expect(normalizeUser({ ...RAW, groups: [1, { id: 2 }] }).groups).toEqual([1, 2])
  })

  // On a mail-less install this is the ONLY way the new user can ever sign in:
  // there is no invitation email, so dropping the link strands the account.
  it('keeps the invite link a mail-less install returns', () => {
    expect(normalizeUser({ ...RAW, invite_link: 'https://r/invite/abc' }).invite_link).toBe(
      'https://r/invite/abc'
    )
  })

  it('leaves invite_link undefined when the payload has none', () => {
    expect(normalizeUser(RAW).invite_link).toBeUndefined()
  })

  it('keeps a disabled user marked disabled', () => {
    expect(normalizeUser({ ...RAW, is_disabled: true }).is_disabled).toBe(true)
  })

  it('keeps a pending invitation marked pending', () => {
    expect(normalizeUser({ ...RAW, is_invitation_pending: true }).is_invitation_pending).toBe(true)
  })

  it('keeps a non-password auth type', () => {
    expect(normalizeUser({ ...RAW, auth_type: 'saml' }).auth_type).toBe('saml')
  })
})

describe('normalizeUser fills in what the payload omits', () => {
  it('gives a user with no fields beyond the required ones a usable row', () => {
    expect(normalizeUser(MINIMAL)).toEqual({
      id: 4,
      name: 'Ada',
      email: 'ada@example.com',
      profile_image_url: '',
      groups: [],
      api_key: '',
      created_at: '',
      updated_at: '',
      is_disabled: false,
      is_invitation_pending: false,
      active_at: '',
      is_email_verified: true,
      auth_type: 'password',
      invite_link: undefined,
    })
  })

  // An absent groups array is a user in no group, not a crash on `.map`.
  it('survives a payload with no groups array', () => {
    expect(normalizeUser({ ...RAW, groups: undefined as never }).groups).toEqual([])
  })

  // A user who has never signed in has active_at null, and the table renders
  // this field directly.
  it('turns a null active_at into an empty string', () => {
    expect(normalizeUser({ ...RAW, active_at: null }).active_at).toBe('')
  })

  // Not false. Most instances do not do email verification at all and send no
  // field, and defaulting to false would badge every user on them as
  // unverified.
  it('assumes email is verified when the instance does not say', () => {
    expect(normalizeUser(MINIMAL).is_email_verified).toBe(true)
  })

  it('still respects an explicit is_email_verified: false', () => {
    expect(normalizeUser({ ...RAW, is_email_verified: false }).is_email_verified).toBe(false)
  })

  it('still respects an explicit is_disabled: false', () => {
    expect(normalizeUser({ ...RAW, is_disabled: false }).is_disabled).toBe(false)
  })
})
