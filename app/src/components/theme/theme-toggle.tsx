'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemePreference } from '@/hooks/use-theme-preference'
import { THEME_PREFERENCES, isThemePreference, type ThemePreference } from '@/lib/theme-preference'
import { cn } from '@/lib/utils'

const THEME_OPTIONS: Record<ThemePreference, { label: string; icon: typeof Sun }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'System', icon: Monitor },
}

/**
 * Light / Dark / System, as a menu rather than a two-state switch.
 *
 * A switch cannot say "follow the OS", and a button that cycles three states
 * makes the reader click twice to find out what the third one is. The menu
 * shows all three at once and reads the same in a 56px rail as in an open one.
 *
 * A radio group rather than plain items: this is a single choice out of three,
 * so the primitive supplies menuitemradio, the checked state and the arrow-key
 * behaviour that go with it, instead of the selection living only in the colour
 * of the current row.
 */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { preference, setPreference } = useThemePreference()
  const current = THEME_OPTIONS[preference]
  const CurrentIcon = current.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            // The name is the control, not the current value: a screen reader
            // should hear what this opens. The value is announced by the
            // checked item inside.
            aria-label="Theme"
            title={collapsed ? `Theme: ${current.label}` : undefined}
            className={cn(
              'w-full gap-3 text-muted-foreground hover:text-foreground',
              collapsed ? 'justify-center px-0' : 'justify-start px-3'
            )}
          />
        }
      >
        <CurrentIcon className="h-4 w-4 shrink-0" />
        {/* "Theme: System", not a bare "System". Every other row in this rail
            is a destination, so a lone value word reads as one, and the admin
            section already has a "System Status" link to be mistaken for. The
            prefix says what the row controls; the word after it says where it
            is set. */}
        <span className={collapsed ? 'sr-only' : undefined}>Theme: {current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(next) => {
            // The primitive types this as a bare string, so it is narrowed
            // rather than asserted: an unknown value is dropped instead of
            // being written to storage.
            if (isThemePreference(next)) setPreference(next)
          }}
        >
          {THEME_PREFERENCES.map((value) => {
            const option = THEME_OPTIONS[value]
            const OptionIcon = option.icon
            return (
              <DropdownMenuRadioItem key={value} value={value} className="gap-2">
                <OptionIcon className="h-4 w-4 shrink-0" />
                {option.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
