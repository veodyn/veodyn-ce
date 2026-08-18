import { User } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The one avatar in the product.
 *
 * `User.profile_image_url` (node/redash/models/users.py) is never null: it
 * falls back to `gravatar.com/avatar/<md5(email)>`, which would send the user's
 * email hash to a third party on every render. So a gravatar URL means "this
 * user has no avatar"; only a genuinely custom image is rendered as an image.
 */

const GRAVATAR_HOST = 'gravatar.com'

/**
 * True only when the URL's *host* is gravatar.com or a subdomain of it.
 *
 * Parsed, not substring-matched: `https://evil.com/?x=gravatar.com` is not a
 * gravatar, while `https://0.gravatar.com/...` and the protocol-relative
 * `//www.gravatar.com/...` that Redash can emit are.
 */
export function isGravatarUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    // The base lets a relative input parse instead of throwing; its reserved
    // TLD can never read as gravatar. The trailing dot of an FQDN is stripped
    // so "gravatar.com." is not a different host.
    host = new URL(url, 'https://avatar.invalid').hostname.toLowerCase().replace(/\.+$/, '')
  } catch {
    return false
  }
  return host === GRAVATAR_HOST || host.endsWith(`.${GRAVATAR_HOST}`)
}

/**
 * One or two letters for the person, or null when there is nothing to show.
 *
 * First-and-last, so "Ada Byron Lovelace" is AL. Falls back to the email local
 * part, then to null, which is the caller's cue to draw a person glyph.
 */
export function initialsOf(name: string | null | undefined, email?: string | null): string | null {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)

  if (words.length === 1) return firstGlyph(words[0])
  if (words.length > 1) return firstGlyph(words[0]) + firstGlyph(words[words.length - 1])

  const local = (email ?? '').trim().split('@')[0]
  return local ? firstGlyph(local) : null
}

function firstGlyph(word: string): string {
  return (Array.from(word)[0] ?? '').toUpperCase()
}

/**
 * The tint pool: categorical chart tokens at 20% under `--foreground` ink.
 * That measures >= 12:1 in light and >= 11:1 in dark; white text on the
 * saturated tokens lands near 3:1 for `--chart-3`, `-6` and `-7` and fails AA.
 *
 * Whole class strings because Tailwind scans source text; a template-built
 * `bg-chart-${n}/20` would never be generated.
 */
const AVATAR_TINTS = [
  'bg-chart-1/20',
  'bg-chart-2/20',
  'bg-chart-3/20',
  'bg-chart-4/20',
  'bg-chart-5/20',
  'bg-chart-6/20',
  'bg-chart-7/20',
  'bg-chart-8/20',
] as const

/** Stable tint for a key. FNV-1a, so it is pure and needs no lookup table. */
export function avatarTintOf(key: string): string {
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return AVATAR_TINTS[(hash >>> 0) % AVATAR_TINTS.length]
}

const SIZE_CLASSES = {
  sm: 'size-7 text-[10px] ring-1 ring-border',
  lg: 'size-16 text-lg ring-2 ring-border ring-offset-2',
} as const

export type UserAvatarSize = keyof typeof SIZE_CLASSES

export const USER_AVATAR_TESTID = 'user-avatar'

export function UserAvatar({
  id,
  name,
  email,
  imageUrl,
  size = 'sm',
  alt,
  className,
}: {
  /** Preferred colour key: names get edited, so tinting by name is unstable. */
  id?: number | string | null
  name?: string | null
  email?: string | null
  imageUrl?: string | null
  size?: UserAvatarSize
  /** Omit where the name is already visible beside the avatar, or a screen
   *  reader says it twice. */
  alt?: string
  className?: string
}) {
  const base = cn('shrink-0 rounded-full', SIZE_CLASSES[size], className)

  if (imageUrl && !isGravatarUrl(imageUrl)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid={USER_AVATAR_TESTID}
        src={imageUrl}
        alt={alt ?? ''}
        className={cn(base, 'object-cover')}
      />
    )
  }

  const initials = initialsOf(name, email)
  const tint = avatarTintOf(id != null ? String(id) : (name ?? ''))
  const labelled = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true }

  return (
    <span
      data-testid={USER_AVATAR_TESTID}
      {...labelled}
      className={cn(
        base,
        tint,
        'inline-flex select-none items-center justify-center font-semibold leading-none text-foreground'
      )}
    >
      {initials ?? <User className={size === 'lg' ? 'size-7' : 'size-3.5'} />}
    </span>
  )
}
