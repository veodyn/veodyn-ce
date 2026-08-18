'use client'

import { Badge } from '@/components/ui/badge'

/**
 * `is_draft` is a listing rule, not an access control:
 * `BaseQueryListResource.get_queries` (node/redash/handlers/queries.py) filters
 * drafts out for everyone but their author, while the single-query read path
 * gates on data source access alone. The copy has to say both halves.
 *
 * Only rendered when config.features.query_drafts is on.
 */
export const DRAFT_BADGE_EXPLANATION =
  'Not shared with the team yet, so it is listed only for you. That is a listing rule and not a permission: anyone who can reach its data source can still open this query by link.'

/** The "Draft" marker, shared by the editor header and the query view page. */
export function QueryDraftBadge() {
  return (
    <Badge variant="outline" title={DRAFT_BADGE_EXPLANATION}>
      <span>Draft</span>
      {/* The explanation has to reach a screen reader too, not only a pointer
          hovering the title attribute. */}
      <span className="sr-only">. {DRAFT_BADGE_EXPLANATION}</span>
    </Badge>
  )
}
