import { Mail, Send, Slack, Webhook, type LucideIcon } from 'lucide-react'

/**
 * One glyph per destination type.
 *
 * Redash hands us an `icon` string per type, but it names a Font Awesome class
 * we do not ship, so every card fell back to the same paper plane and the
 * picker read as a row of copies of one unfinished button. lucide carries no
 * brand marks for most of these services and we are not adding an icon pack,
 * so each type gets the nearest generic glyph instead. `Send` stays as the
 * fallback: the enabled list is configurable server-side and
 * REDASH_ADDITIONAL_DESTINATIONS can name a plugin that ships outside this
 * tree, so a type we have never seen still has to render.
 */
export const DESTINATION_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  slack: Slack,
  webhook: Webhook,
}

export const FALLBACK_DESTINATION_ICON = Send

export function DestinationIcon({ type, className }: { type?: string | null; className?: string }) {
  // Indexed inline rather than through a helper: a component value returned
  // from a function call trips react-hooks/static-components.
  const Icon = DESTINATION_ICONS[type ?? ''] ?? FALLBACK_DESTINATION_ICON
  // The type name is always spelled out in text beside the icon, so the glyph
  // is decoration and repeating it would only make the label say itself twice.
  return <Icon className={className} aria-hidden="true" />
}
