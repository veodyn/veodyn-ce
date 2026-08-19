// Pure, config-driven sidebar information architecture (umbrella section 5).
// The primary group and section groups are fixed; config domains append as Data
// hub links (routes land in plan 04) and ADMIN renders only for admins. No React
// or config-provider access here so the IA is unit-testable in isolation.
//
// The feature-owned rows (KPIs, Reports, Alerts, Shared Links) are not listed
// here: they are spliced in from featureNavRows(section), the seam over
// src/features/. A build with no feature directories installed contributes no
// rows and the surrounding CE rows carry the section, so LIBRARY, MONITOR and
// ADMIN never render empty. See app/src/features/index.ts and types.ts.
import {
  Activity,
  AlertTriangle,
  Bus,
  CalendarClock,
  Car,
  Code2,
  Compass,
  Database,
  Folder,
  Globe,
  Home,
  LayoutDashboard,
  ListChecks,
  Plane,
  Plug,
  Radio,
  Scissors,
  Search,
  Server,
  Settings,
  Ship,
  Star,
  TrainFront,
  Users,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import type { ClientConfig } from '@/lib/config-schema'
import { featureNavRows, type NavSectionId } from '@/features'

export interface NavLink {
  label: string
  href: string
  icon: LucideIcon
}

export interface NavSection {
  /** Stable id for React keys and tests. A null label means an ungrouped group. */
  id: string
  label: string | null
  items: NavLink[]
}

export interface SidebarModelInput {
  domains: ClientConfig['domains']
  canAccessAdmin: boolean
  /**
   * Whether the user may see the INSTANCE-wide admin rows (system status,
   * query jobs, outdated queries), as opposed to the org-scoped ones. Those
   * three read Redash endpoints Redash gates with super_admin, and the proxy
   * in front of them gates the same way, so an org admin shown these rows
   * would be shown three links that answer 403. Separate from canAccessAdmin
   * because an org admin still administers their own org.
   */
  canViewInstanceAdmin: boolean
  /** Instance feature switches. A surface that is off has no row here. */
  features: ClientConfig['features']
}

// Curated subset of lucide names an operator is likely to tag a transport
// domain with. Anything else falls back to Folder; full name resolution can
// arrive with the Data Catalog (plan 04).
const DOMAIN_ICONS: Record<string, LucideIcon> = {
  bus: Bus,
  car: Car,
  train: TrainFront,
  ship: Ship,
  plane: Plane,
  globe: Globe,
  wind: Wind,
  activity: Activity,
}

// Exported so /data/[domain] can render the same icon next to the hub title
// (DomainHub.icon documents this as the resolution path; see types/catalog.ts).
export function resolveDomainIcon(name?: string): LucideIcon {
  if (!name) return Folder
  return DOMAIN_ICONS[name.toLowerCase()] ?? Folder
}

export function buildSidebarSections(
  { domains, canAccessAdmin, canViewInstanceAdmin, features }: SidebarModelInput,
  // The feature-row lookup as an explicit input, defaulting to the real
  // registry seam. Tests pass an explicitly empty lookup to prove no section
  // collapses without mocking @/features.
  featureNav: (section: NavSectionId) => ReturnType<typeof featureNavRows> = featureNavRows
): NavSection[] {
  // A row per switched-off surface, dropped rather than disabled: a nav entry
  // that leads to a 404 is worse than no entry.
  const libraryItems: NavLink[] = [
    { label: 'Queries', href: '/queries', icon: Code2 },
    { label: 'Dashboards', href: '/dashboards', icon: LayoutDashboard },
    // KPIs and Reports, if their feature directories are installed.
    ...featureNav('library'),
    ...(features.query_snippets
      ? [{ label: 'Query Snippets', href: '/query-snippets', icon: Scissors }]
      : []),
    // No Folders item: Redash has no folder model, so the link went to a page
    // that could not be written. Tags are how this product groups queries and
    // dashboards.
  ]
  const primary: NavSection = {
    id: 'primary',
    label: null,
    items: [
      { label: 'Home', href: '/', icon: Home },
      { label: 'Search', href: '/search', icon: Search },
      // Every label here is the destination page's own h1, verbatim. A nav
      // that says "Data" and lands on "Data Catalog" makes the reader check
      // whether they arrived somewhere else.
      { label: 'Data Catalog', href: '/data', icon: Database },
      { label: 'Discover', href: '/discover', icon: Compass },
      { label: 'Favorites', href: '/favorites', icon: Star },
      ...domains.map((d) => ({
        label: d.label,
        href: `/data/${d.key}`,
        icon: resolveDomainIcon(d.icon),
      })),
    ],
  }

  const sections: NavSection[] = [
    primary,
    // Library before Monitor: the things people come here to open and author
    // are the everyday traffic, and monitoring is what they check when
    // something looks wrong. The nav reads in that order rather than putting
    // the exception first.
    {
      id: 'library',
      label: 'LIBRARY',
      items: libraryItems,
    },
    {
      id: 'monitor',
      label: 'MONITOR',
      items: [
        { label: 'Captures', href: '/captures', icon: Activity },
        { label: 'Schedules', href: '/schedules', icon: CalendarClock },
        // Alerts, if its feature directory is installed.
        ...featureNav('monitor'),
      ],
    },
    {
      id: 'connect',
      label: 'CONNECT',
      items: [
        { label: 'APIs', href: '/connect/apis', icon: Plug },
        { label: 'MCP', href: '/connect/mcp', icon: Server },
        // Not admin-gated: the published-feeds API serves this list to any
        // org member, so hiding the row would be a lie told only to the
        // sidebar. Only the create action on the page itself is admin-gated.
        { label: 'Published Feeds', href: '/connect/feeds', icon: Radio },
      ],
    },
  ]

  if (canAccessAdmin) {
    sections.push({
      id: 'admin',
      label: 'ADMIN',
      items: [
        { label: 'Data Sources', href: '/data-sources', icon: Database },
        { label: 'Alert Destinations', href: '/destinations', icon: Server },
        { label: 'Team', href: '/users', icon: Users },
        // Shared Links, if the reports feature directory is installed. Org
        // scoped like the rows above it: both backends behind it gate on org
        // admin, not super_admin, so it belongs here rather than behind
        // canViewInstanceAdmin. Gated behind canAccessAdmin exactly by this
        // block, the same way it always was.
        ...featureNav('admin'),
        // Reads the client-side registry, so unlike Shared Links it calls no
        // Redash endpoint and needs no super_admin.
        { label: 'Plugins', href: '/admin/plugins', icon: Plug },
        { label: 'Settings', href: '/settings', icon: Settings },
        // Dropped rather than disabled for the same reason the switched-off
        // library rows are: these three answer 403 without super_admin.
        ...(canViewInstanceAdmin
          ? [
              { label: 'System Status', href: '/admin/status', icon: Activity },
              { label: 'Query Jobs', href: '/admin/jobs', icon: ListChecks },
              { label: 'Outdated Queries', href: '/admin/outdated', icon: AlertTriangle },
            ]
          : []),
      ],
    })
  }

  return sections
}
