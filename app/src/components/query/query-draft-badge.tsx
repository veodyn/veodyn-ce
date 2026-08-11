'use client'

import { Badge } from '@/components/ui/badge'

/**
 * What "draft" actually means here, spelled out because the word reads as
 * "private" and it is only half that.
 *
 * `is_draft` is a listing rule. `Query.all_queries` filters drafts out for
 * everyone but their author when it is called with `include_drafts=False`, and
 * `BaseQueryListResource.get_queries` in node/redash/handlers/queries.py now
 * passes exactly that on both the list and the search path. So a draft is
 * absent from other people's query list and present in its author's.
 *
 * What it is NOT is an access control. The single-query read path never looks
 * at the flag and gates on data source access alone, so anyone who could open
 * the query by link before can still open it. Sharing a draft grants nobody
 * anything and drafting a shared query revokes nothing; only the listing moves.
 * This copy says both halves, because promising privacy the backend does not
 * deliver is the failure mode this string has already had once.
 *
 * Only ever rendered when config.features.query_drafts is on. With the flag off
 * saving shares the query, nothing is ever left in this state, and the word
 * "draft" appears nowhere in the product.
 */
export const DRAFT_BADGE_EXPLANATION =
  'Not shared with the team yet, so it is listed only for you. That is a listing rule and not a permission: anyone who can reach its data source can still open this query by link.'

/**
 * The "Draft" marker for a query title. Its own component because both the
 * editor header and the query view page need the same one word to mean the
 * same thing.
 */
export function QueryDraftBadge() {
  return (
    <Badge variant="outline" title={DRAFT_BADGE_EXPLANATION}>
      <span>Draft</span>
      {/* The explanation is the whole point of the badge, so it has to reach a
          screen reader too, not only a pointer hovering the title attribute. */}
      <span className="sr-only">. {DRAFT_BADGE_EXPLANATION}</span>
    </Badge>
  )
}
