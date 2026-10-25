import { cookieReader } from './redash-get'
import { chatHeaders, type ChatUpstream } from './relay'
import { readSubjectDetail, type ChatSubjectDetail } from './subject-detail'
import { threadSubjectResponseSchema } from './wire'

export const SUBJECT_READ_TIMEOUT_MS = 4000

export async function subjectDetailFor(
  request: Request,
  threadId: string,
  gate: ChatUpstream,
  timeoutMs: number = SUBJECT_READ_TIMEOUT_MS
): Promise<ChatSubjectDetail | null> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
  try {
    const response = await fetch(`${gate.endpoint}/chat/threads/${threadId}/subject`, {
      method: 'GET',
      headers: chatHeaders(gate.subject),
      signal,
    })
    if (!response.ok) return null
    const parsed = threadSubjectResponseSchema.safeParse(await response.json())
    if (!parsed.success || parsed.data.subject === null) return null
    return await readSubjectDetail(parsed.data.subject, cookieReader(request.headers.get('cookie')), signal)
  } catch {
    return null
  }
}
