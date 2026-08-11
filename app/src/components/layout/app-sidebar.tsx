'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useToast } from '@/components/shared/toast-provider'
import { useConfig } from '@/components/config/config-provider'
import { buildSidebarSections } from '@/lib/sidebar-nav'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BrandMark, SidebarNav, SidebarFooter } from './sidebar-body'
import { useSidebarCollapsed } from './use-sidebar-collapsed'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export function AppSidebar() {
  const pathname = usePathname()
  const currentUser = useAuthStore((s) => s.currentUser)
  const logout = useAuthStore((s) => s.logout)
  const toast = useToast()
  const { brand, domains, features } = useConfig()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()

  // Only the server can clear the httpOnly session cookie. If that request
  // fails the session is still live, so saying nothing and showing a sign-in
  // screen would be the same lie this control used to tell.
  const handleLogout = async () => {
    if (!(await logout())) {
      toast.error('Could not sign out. You are still signed in: check your connection and retry.')
    }
  }

  if (!currentUser) return null

  const sections = buildSidebarSections({
    domains,
    canAccessAdmin: currentUser.isAdmin,
    canViewInstanceAdmin: currentUser.hasPermission('super_admin'),
    features,
  })

  // `rail` is true only for the desktop shell. The drawer takes the same body
  // and never collapses it, and it never offers the toggle: a drawer you opened
  // on purpose has no reason to become a 56px rail, and it closes on navigation
  // anyway.
  function renderBody({ rail = false, onNavigate }: { rail?: boolean; onNavigate?: () => void } = {}) {
    const isCollapsed = rail && collapsed
    return (
      <>
        <BrandMark name={brand.name} logo={brand.logo} collapsed={isCollapsed} />
        {/* min-h-0 is load-bearing: a flex item defaults to min-height:auto, so
            without it flex-1 resolves to the nav's content height and the
            scroller never scrolls. */}
        <ScrollArea className="min-h-0 flex-1">
          <SidebarNav
            sections={sections}
            pathname={pathname}
            collapsed={isCollapsed}
            onNavigate={onNavigate}
          />
        </ScrollArea>
        <SidebarFooter
          helpUrl={brand.help_url}
          docsUrl={brand.docs_url}
          onLogout={handleLogout}
          collapsed={isCollapsed}
          onToggleCollapsed={rail ? toggleCollapsed : undefined}
          onNavigate={onNavigate}
        />
      </>
    )
  }

  return (
    <>
      {/* Desktop rail, in flow so the main region needs no offset. h-screen +
          sticky rather than plain flex stretch: the parent is min-h-screen, so
          a tall page would otherwise stretch this to the full document height,
          push the footer below the fold, and leave the nav unable to scroll.
          Width is the only thing collapsing changes out here; everything inside
          reads `collapsed` for itself. */}
      <aside
        className={cn(
          'hidden md:sticky md:top-0 md:flex md:h-screen md:shrink-0 md:flex-col md:border-r md:border-border md:bg-sidebar md:transition-[width]',
          collapsed ? 'md:w-14' : 'md:w-60'
        )}
      >
        {renderBody({ rail: true })}
      </aside>

      {/* Mobile top bar + Sheet drawer. */}
      <div className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-sidebar px-3 md:hidden">
        <BrandMark name={brand.name} logo={brand.logo} />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          {/* This bar is not only phones: a narrow desktop window gets it too,
              and there the hamburger has a pointer and a keyboard to explain
              itself to. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <SheetTrigger
                  aria-label="Open navigation"
                  render={<Button variant="ghost" size="icon" />}
                />
              }
            >
              <Menu className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Open navigation</TooltipContent>
          </Tooltip>
          <SheetContent side="left" className="flex w-64 flex-col p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {renderBody({ onNavigate: () => setMobileOpen(false) })}
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
