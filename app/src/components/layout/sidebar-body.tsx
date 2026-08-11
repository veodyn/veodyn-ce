'use client'

// The presentational pieces of the app sidebar: the brand mark, the nav and the
// footer. Split from app-sidebar.tsx, which owns the state and the two shells
// these render into (the desktop rail and the mobile drawer), so neither file
// carries both jobs.
//
// Every piece takes `collapsed`. The mobile drawer always passes false: a
// drawer you have deliberately opened has no reason to be a 56px rail.

import type { ReactElement } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { BookOpen, ChevronLeft, ChevronRight, HelpCircle, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IdentitySwitcher } from '@/components/auth/identity-switcher'
import type { NavSection } from '@/lib/sidebar-nav'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeToggle } from '@/components/theme/theme-toggle'

/**
 * The label of a collapsed rail item: still in the accessible tree, still
 * announced, just not taking horizontal space.
 *
 * `sr-only` rather than removing the text, so the link keeps its accessible
 * name and does not become an unnamed icon.
 */
function ItemLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  return <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
}

/**
 * Gives a collapsed rail item back the label the rail took away, on hover and
 * on keyboard focus.
 *
 * Only when collapsed: an expanded item already reads its own name, and a
 * tooltip that repeats a visible label is noise. This used to be a `title`
 * attribute, which the pointer gets after a browser-controlled delay of about a
 * second, in the OS tooltip style, and which a keyboard never gets at all. The
 * app mounts one TooltipProvider (see `app/providers.tsx`), so the machinery
 * that argument was avoiding is a single import now.
 */
function RailTooltip({
  label,
  collapsed,
  children,
}: {
  label: string
  collapsed: boolean
  children: ReactElement
}) {
  if (!collapsed) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function BrandMark({
  name,
  logo,
  collapsed = false,
}: {
  name: string
  logo: string | null
  collapsed?: boolean
}) {
  return (
    // The mark shows who you are looking at; the tooltip says where clicking it
    // goes, which is the part a collapsed rail hides.
    <RailTooltip label="Home" collapsed={collapsed}>
      <Link
        href="/"
        className={cn('flex items-center gap-2 h-14 shrink-0', collapsed ? 'justify-center px-0' : 'px-3')}
      >
        {logo ? (
          <Image src={logo} alt={name} width={24} height={24} className="rounded-sm shrink-0" />
        ) : null}
        {/* With no logo there would be nothing left to click on, so a collapsed
            rail falls back to the first letter rather than an empty box. */}
        <span
          className={cn(
            'font-display text-lg font-medium text-foreground',
            collapsed && logo && 'sr-only'
          )}
        >
          {collapsed && !logo ? name.charAt(0) : name}
        </span>
      </Link>
    </RailTooltip>
  )
}

export function SidebarNav({
  sections,
  pathname,
  collapsed = false,
  onNavigate,
}: {
  sections: NavSection[]
  pathname: string
  collapsed?: boolean
  /** Fires when a link is clicked. The mobile sheet uses this to close itself. */
  onNavigate?: () => void
}) {
  return (
    <nav className={cn('flex flex-col gap-4 py-2', collapsed ? 'px-1.5' : 'px-2')}>
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          {/* A collapsed rail has no width for "LIBRARY", and a truncated
              heading is worse than none: the gap between groups already says
              where one ends. The separator keeps that reading without text. */}
          {section.label && collapsed ? (
            <Separator className="my-1" />
          ) : section.label ? (
            <p className="px-3 pt-2 pb-1 font-mono text-[0.68rem] uppercase tracking-wider text-muted-foreground">
              {section.label}
            </p>
          ) : null}
          {section.items.map((item) => {
            // Section-parent links (e.g. /data) stay visually "active" for any
            // nested route so the section reads as current, but only the exact
            // path match may claim aria-current: otherwise a domain route like
            // /data/transit would mark both /data and /data/transit as current.
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const isExactMatch = pathname === item.href
            return (
              <RailTooltip key={item.href} label={item.label} collapsed={collapsed}>
                <Link
                  href={item.href}
                  aria-current={isExactMatch ? 'page' : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-3 rounded-md py-2 text-sm transition-colors',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    // The active background is the only thing marking the
                    // current route once the labels are gone, so it stays
                    // either way.
                    isActive
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <ItemLabel label={item.label} collapsed={collapsed} />
                </Link>
              </RailTooltip>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function SidebarFooter({
  helpUrl,
  docsUrl,
  onLogout,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  helpUrl: string | null
  /** The product documentation site (brand.docs_url); help_url stays the tenant's own support site. */
  docsUrl: string | null
  onLogout: () => void | Promise<void>
  collapsed?: boolean
  /** Absent in the mobile drawer, which is never a rail. */
  onToggleCollapsed?: () => void
  // Profile is the only in-app link down here, and the sidebar outlives a
  // client-side navigation, so without this the mobile drawer stays open on
  // top of the page it just navigated to. Help opens a new tab and Sign Out
  // tears the session down, so neither needs it.
  onNavigate?: () => void
}) {
  const row = cn(
    'flex items-center gap-3 rounded-md py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground',
    collapsed ? 'justify-center px-0' : 'px-3'
  )
  return (
    <div className={cn('mt-auto flex flex-col gap-0.5 py-2', collapsed ? 'px-1.5' : 'px-2')}>
      {/* Theme and collapsing are both properties of this browser rather than
          of the account, so they sit together above the divider with the rest
          of the chrome, not below it among Profile and Sign Out. */}
      <ThemeToggle collapsed={collapsed} />
      {onToggleCollapsed ? (
        <RailTooltip label="Expand sidebar" collapsed={collapsed}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapsed}
            // The name says what the click does, not what the state is, so a
            // screen reader hears the action rather than having to infer it from
            // a chevron. aria-expanded carries the state.
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn(
              'w-full gap-3 text-muted-foreground hover:text-foreground',
              collapsed ? 'justify-center px-0' : 'justify-start px-3'
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
            <ItemLabel label="Collapse" collapsed={collapsed} />
          </Button>
        </RailTooltip>
      ) : null}
      <Separator className="my-2" />
      {/* The switcher is a name, an email and a menu: there is no honest way to
          show it in a 56px rail, so it waits for the rail to open. */}
      {collapsed ? null : <IdentitySwitcher />}
      <RailTooltip label="Profile" collapsed={collapsed}>
        <Link href="/profile" onClick={onNavigate} className={row}>
          <User className="h-4 w-4 shrink-0" />
          <ItemLabel label="Profile" collapsed={collapsed} />
        </Link>
      </RailTooltip>
      {docsUrl ? (
        <RailTooltip label="Documentation (opens in a new tab)" collapsed={collapsed}>
          <a href={docsUrl} target="_blank" rel="noopener noreferrer" className={row}>
            <BookOpen className="h-4 w-4 shrink-0" />
            <ItemLabel label="Documentation" collapsed={collapsed} />
          </a>
        </RailTooltip>
      ) : null}
      {helpUrl ? (
        <RailTooltip label="Help (opens in a new tab)" collapsed={collapsed}>
          <a href={helpUrl} target="_blank" rel="noopener noreferrer" className={row}>
            <HelpCircle className="h-4 w-4 shrink-0" />
            <ItemLabel label="Help" collapsed={collapsed} />
          </a>
        </RailTooltip>
      ) : null}
      <RailTooltip label="Sign Out" collapsed={collapsed}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void onLogout()}
          className={cn(
            'w-full gap-3 text-muted-foreground hover:text-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start px-3'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <ItemLabel label="Sign Out" collapsed={collapsed} />
        </Button>
      </RailTooltip>
    </div>
  )
}
