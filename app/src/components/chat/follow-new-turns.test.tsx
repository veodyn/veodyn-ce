import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FollowNewTurns } from './follow-new-turns'

const scroller = vi.hoisted(() => ({ scrollToEnd: vi.fn() }))

vi.mock('@/components/ui/message-scroller', () => ({ useMessageScroller: () => scroller }))

beforeEach(() => {
  scroller.scrollToEnd.mockReset()
})

describe('FollowNewTurns', () => {
  it('scrolls to the end when a turn is added after the thread loaded', () => {
    const { rerender } = render(<FollowNewTurns lastTurnId={null} loading />)
    rerender(<FollowNewTurns lastTurnId="t1" loading={false} />)
    expect(scroller.scrollToEnd).not.toHaveBeenCalled()
    rerender(<FollowNewTurns lastTurnId="t1" loading={false} />)
    expect(scroller.scrollToEnd).not.toHaveBeenCalled()
    rerender(<FollowNewTurns lastTurnId="t2" loading={false} />)
    expect(scroller.scrollToEnd).toHaveBeenCalledWith({ behavior: 'smooth' })
  })

  it('does not scroll for the first turn of an empty thread until one is added', () => {
    const { rerender } = render(<FollowNewTurns lastTurnId={null} loading={false} />)
    expect(scroller.scrollToEnd).not.toHaveBeenCalled()
    rerender(<FollowNewTurns lastTurnId="t1" loading={false} />)
    expect(scroller.scrollToEnd).toHaveBeenCalledTimes(1)
  })
})
