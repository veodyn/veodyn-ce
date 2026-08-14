// The pack a build gets when it has a real backend to talk to.
//
// Nothing imports this by name. next.config.ts resolves `./packs/active` here
// when NEXT_PUBLIC_REDASH_URL is set, which is the one condition under which
// USE_REAL_API is true and no fixture is ever read: every one of the eight
// modules that reads a fixture value does so in the else-branch of an
// `if (USE_REAL_API)`, or behind a component that returns null in real mode
// (identity-switcher). Audited 2026-08-02; ./packs.test.ts is what keeps this
// file in step with the pack it stands in for.
//
// The point is bundle size. The LA pack is 196 KB of source and the neutral
// pack 192 KB, and before this existed BOTH shipped to the browser on every
// route of every build, including a production build pointed at a real Redash.
// A reader of /login was downloading Jane Analyst's fixture rows.
import type { MockUser } from './types/users'
import type { MockQuery } from './types/query-types'
import type { MockQueryResult } from './types/query-results'
import type { MockDashboard } from './types/dashboard-types'
import type { MockDataSource } from './types/data-sources'
import type { MockDataSourceType } from './types/data-source-types'
import type { MockAlert } from './types/alerts'
import type { MockGroup } from './types/groups'
import type { MockDestination } from './types/destinations'
import type { MockDestinationType } from './types/destination-types'
import type { MockQuerySnippet } from './types/query-snippets'
import type { SchemaTable } from './types/schema'
import type { Dataset, DomainHub } from '@/types/catalog'
import type { Annotation } from '@/types/annotation'
import type { Feed } from '@/types/feed'
import type { PublishAttempt, PublishedFeed } from '@/types/published-feed'

export const mockUsers: MockUser[] = []

/**
 * The sole non-collection export, so the sole one that cannot simply be empty.
 *
 * Filled in rather than cast away from undefined: a crash in a real deployment
 * would be a worse outcome than the bytes this file exists to save, and the
 * guard audit above is evidence, not a proof. Filled in with a value that
 * cannot be mistaken for a person or matched by a sign-in: `mockUsers` is empty
 * so the mock login lookup finds nobody, and the empty email matches no
 * credential. If this ever reaches a screen it reads as the bug it is.
 */
export const currentUser: MockUser = {
  id: -1,
  name: 'Mock mode is off in this build',
  email: '',
  profile_image_url: '',
  groups: [],
  api_key: '',
  created_at: '',
  updated_at: '',
  is_disabled: true,
  is_invitation_pending: false,
  active_at: '',
  is_email_verified: false,
  auth_type: '',
}

export const mockQueries: MockQuery[] = []
export const mockQueryResults: Record<number, MockQueryResult> = {}
export const mockDashboards: MockDashboard[] = []
export const mockDataSources: MockDataSource[] = []
export const mockDataSourceTypes: MockDataSourceType[] = []
export const mockAlerts: MockAlert[] = []
export const mockGroups: MockGroup[] = []
export const mockDestinations: MockDestination[] = []
export const mockDestinationTypes: MockDestinationType[] = []
export const mockQuerySnippets: MockQuerySnippet[] = []
export const mockSchema: Record<number, SchemaTable[]> = {}
export const mockDatasets: Dataset[] = []
export const mockDomainHubs: DomainHub[] = []
export const mockAnnotations: Annotation[] = []
export const mockFeeds: Feed[] = []
export const mockPublishedFeeds: PublishedFeed[] = []
export const mockPublishAttempts: Record<string, PublishAttempt[]> = {}
