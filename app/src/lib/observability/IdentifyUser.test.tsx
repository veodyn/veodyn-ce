import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureMock = vi.hoisted(() => ({ identifyUser: vi.fn(), resetIdentity: vi.fn() }))
vi.mock('./capture', () => captureMock)

import { useAuthStore } from '@/stores/auth-store'
import { IdentifyUser } from './IdentifyUser'

const ada = { id: 7, name: 'Ada', email: 'ada@example.test' }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ currentUser: null })
})

describe('IdentifyUser', () => {
  it('identifies nobody when signed out', () => {
    render(<IdentifyUser />)
    expect(captureMock.identifyUser).not.toHaveBeenCalled()
  })

  it('identifies the signed-in user by redash id, as a string', () => {
    useAuthStore.setState({ currentUser: ada as never })
    render(<IdentifyUser />)
    expect(captureMock.identifyUser).toHaveBeenCalledWith({
      id: '7',
      name: 'Ada',
      email: 'ada@example.test',
    })
  })

  it('resets identity when the user signs out', () => {
    useAuthStore.setState({ currentUser: ada as never })
    const { rerender } = render(<IdentifyUser />)
    useAuthStore.setState({ currentUser: null })
    rerender(<IdentifyUser />)
    expect(captureMock.resetIdentity).toHaveBeenCalled()
  })

  it('renders nothing', () => {
    const { container } = render(<IdentifyUser />)
    expect(container).toBeEmptyDOMElement()
  })
})
