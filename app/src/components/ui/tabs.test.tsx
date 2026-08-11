import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

describe('Tabs', () => {
  it('switches the visible panel when a tab is clicked', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent value="b">Panel B</TabsContent>
      </Tabs>
    )

    expect(screen.getByText('Panel A')).toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(screen.getByText('Panel B')).toBeVisible()
  })
})
