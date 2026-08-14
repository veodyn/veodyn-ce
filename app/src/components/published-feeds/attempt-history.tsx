import { FindingsList } from '@/components/published-feeds/findings-list'
import { TimeAgo } from '@/components/shared/time-ago'
import { cn } from '@/lib/utils'
import type { PublishAttempt } from '@/types/published-feed'

// Every publish attempt this instance has recorded for one feed, newest
// first. A blocked attempt's `reason` is only a count ("2 conformance
// error(s)"), so its findings are what actually explains the refusal and are
// what renders here, not the sentence. A failed attempt is the opposite: the
// machinery never reached a verdict, so there is no finding to list and the
// one reason sentence is the whole explanation.
const DECISION_LABEL: Record<PublishAttempt['decision'], string> = {
  published: 'Published',
  blocked: 'Blocked',
  failed: 'Failed',
}

const DECISION_TEXT: Record<PublishAttempt['decision'], string> = {
  published: 'text-status-fresh',
  blocked: 'text-destructive',
  failed: 'text-destructive',
}

function AttemptRow({ attempt }: { attempt: PublishAttempt }) {
  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TimeAgo date={attempt.createdAt} />
        <span className={cn('text-sm font-medium', DECISION_TEXT[attempt.decision])}>
          {DECISION_LABEL[attempt.decision]}
        </span>
        <span className="font-mono text-xs text-muted-foreground">rev {attempt.bindingRevision}</span>
        {attempt.isCurrent && (
          <span className="text-xs font-medium text-status-fresh">Currently serving</span>
        )}
      </div>
      {attempt.decision === 'blocked' && <FindingsList findings={attempt.findings} />}
      {attempt.decision === 'failed' && <p className="text-sm text-muted-foreground">{attempt.reason}</p>}
      {attempt.decision === 'published' && attempt.findings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Warnings the feed published with</p>
          <FindingsList findings={attempt.findings} />
        </div>
      )}
    </li>
  )
}

export function AttemptHistory({ attempts }: { attempts: PublishAttempt[] }) {
  if (attempts.length === 0) {
    return <p className="text-sm text-muted-foreground">No publish attempts recorded yet.</p>
  }
  // Newest first, by timestamp rather than by array order. The fixtures and
  // the mock store both hand this back newest-first already, but nothing in
  // the contract promises it, so display order is derived rather than
  // assumed.
  const ordered = [...attempts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  return (
    <ul className="space-y-2">
      {ordered.map((attempt) => (
        <AttemptRow key={attempt.attemptId} attempt={attempt} />
      ))}
    </ul>
  )
}
