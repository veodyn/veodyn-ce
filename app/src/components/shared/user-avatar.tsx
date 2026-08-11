import { User } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The one avatar in the product.
 *
 * Redash never returns a null `profile_image_url`. `User.profile_image_url`
 * (node/redash/models/users.py) falls back to a synthesised
 * `gravatar.com/avatar/<md5(email)>?s=40&d=identicon`, so every
 * `url ? <img/> : <initials/>` branch in this app took the image path 100% of
 * the time and every initials fallback was dead code. Three things followed
 * from that: the dated green identicon, a 40px image upscaled into a 64px
 * circle, and an unconditional third-party request carrying the user's email
 * hash to gravatar.com on every render. The last one is disqualifying on its
 * own for a white-label product that ships to other people's clusters.
 *
 * So the rule here is: a gravatar URL means "this user has no avatar". Only a
 * genuinely custom image is rendered as an image.
 */

const GRAVATAR_HOST = 'gravatar.com'

/**
 * True only when the URL's *host* is gravatar.com or a subdomain of it.
 *
 * Parsing rather than substring matching, because both directions are wrong:
 * `https://evil.com/?x=gravatar.com` is not a gravatar (and suppressing it
 * would silently blank a real avatar), while `https://0.gravatar.com/...` and
 * the protocol-relative `//www.gravatar.com/...` that Redash can emit are.
 */
export function isGravatarUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    // The base lets a relative input parse instead of throwing. Its host is a
    // reserved TLD no avatar can claim, so a relative path never reads as
    // gravatar. The trailing dot of an absolute FQDN is stripped so
    // "gravatar.com." is not treated as a different host.
    host = new URL(url, 'https://avatar.invalid').hostname.toLowerCase().replace(/\.+$/, '')
  } catch {
    return false
  }
  return host === GRAVATAR_HOST || host.endsWith(`.${GRAVATAR_HOST}`)
}

/**
 * One or two letters for the person, or null when there is nothing to show.
 *
 * First-and-last rather than first-two-words: "Ada Byron Lovelace" is AL, not
 * AB. Code-point slicing rather than `[0]`, so an astral character (many CJK
 * extensions, an emoji in a display name) yields one glyph instead of half a
 * surrogate pair. Falls back to the email local part when the name is empty or
 * only whitespace, and to null when even that is missing, which is the caller's
 * cue to draw a neutral person glyph instead of an empty circle.
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
 * The tint pool.
 *
 * These are the app's own categorical chart tokens, used at low alpha so the
 * initials sit in `--foreground` ink. That is what makes the contrast safe in
 * both themes without a per-swatch exception: in light mode a 20% tint over a
 * near-white surface stays above 0.72 relative luminance (>= 12:1 against
 * `--foreground`), and in dark mode the same 20% over `--card` stays below 0.03
 * (>= 11:1). Painting white text straight onto the saturated tokens would not
 * survive that: `--chart-3`, `--chart-6` and `--chart-7` all land near 3:1 on
 * white and fail AA.
 *
 * Written out as whole class strings because Tailwind scans source text; a
 * template-built `bg-chart-${n}/20` would never be generated.
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

// Ring treatments are per size because that is how the call sites already
// differed: the 64px profile header rings with an offset, the 28px list rows
// hairline against the row border.
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
  /** Preferred colour key. Names get edited; an avatar that changes colour
   *  because someone fixed a typo in their name is a bug. */
  id?: number | string | null
  name?: string | null
  email?: string | null
  imageUrl?: string | null
  size?: UserAvatarSize
  /** Omit at every site where the person's name is already visible beside the
   *  avatar: repeating it only makes a screen reader say it twice. */
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
