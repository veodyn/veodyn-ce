import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

describe('Card', () => {
  it('renders its title and body', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>T</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>
    )

    expect(screen.getByText('T')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })
})
