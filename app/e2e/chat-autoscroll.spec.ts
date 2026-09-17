import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Page } from '@playwright/test'

const THREAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STAMP = '2026-09-17T00:00:00Z'
const LONG = 'This answer keeps going so the conversation needs scrolling. '.repeat(12)

function storedTurn(seq: number) {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(seq).padStart(12, '0')}`,
    seq,
    status: 'done',
    userText: `Question ${seq}`,
    blocks: [{ role: 'assistant', content: [{ type: 'text', text: `Answer ${seq}. ${LONG}` }] }],
    stopReason: 'end_turn',
    errorId: null,
    createdAt: STAMP,
    finishedAt: STAMP,
  }
}

const thread = { id: THREAD, title: 'Scroll', pinned: false, createdAt: STAMP, updatedAt: STAMP, lastTurnAt: STAMP }

let server: Server
let streamUrl = ''

test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const frames: [string, unknown][] = [['turn_started', { turnId: TURN, seq: 9 }]]
    const lines = (from: number, to: number) => {
      for (let index = from; index < to; index += 1) frames.push(['text_delta', { text: `Streamed line ${index}.\n\n` }])
    }
    if (request.url?.includes('tools')) {
      lines(0, 5)
      for (const callId of ['s1', 's2', 's3']) {
        frames.push(['tool_request', { callId, tool: 'search_library', args: { text: 'bikeshare', kinds: ['query'], tags: [] } }])
        frames.push(['tool_settled', { callId, ok: true, durationMs: 5, count: 0 }])
        lines(0, 3)
      }
      lines(35, 40)
    } else {
      lines(0, 40)
    }
    frames.push(['turn_done', { stopReason: 'end_turn', usage: {} }])
    let index = 0
    const timer = setInterval(() => {
      const frame = frames[index]
      if (!frame) {
        clearInterval(timer)
        response.end()
        return
      }
      response.write(`id: 1-${index}\nevent: ${frame[0]}\ndata: ${JSON.stringify(frame[1])}\n\n`)
      index += 1
    }, 40)
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  streamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

async function ensureAuthed(page: Page) {
  await page.goto('/')
  const email = page.getByRole('textbox', { name: /email/i })
  if (await email.isVisible().catch(() => false)) {
    await email.fill('admin@example.com')
    await page.getByLabel(/password/i).fill('mock')
    await page.getByRole('button', { name: /sign in/i }).click()
  }
  await page.waitForLoadState('networkidle')
}

function runningTurn() {
  return { ...storedTurn(1), id: TURN, seq: 1, status: 'running', blocks: [], stopReason: null, finishedAt: null }
}

async function mockChat(
  page: Page,
  turns: unknown[] = Array.from({ length: 8 }, (_, index) => storedTurn(index + 1)),
  script = 'text'
) {
  await page.route('**/api/ai/chat/threads?*', (route) =>
    route.fulfill({ json: { threads: [thread], nextOffset: null } })
  )
  await page.route(`**/api/ai/chat/threads/${THREAD}`, (route) =>
    route.fulfill({ json: { thread, drafts: [], turns } })
  )
  await page.route(`**/api/ai/chat/threads/${THREAD}/turns`, (route) =>
    route.fulfill({ status: 202, json: { turnId: TURN, seq: 9 } })
  )
  await page.route(`**/api/ai/chat/turns/${TURN}/stream`, (route) => route.continue({ url: `${streamUrl}/${script}` }))
  await page.route(`**/api/ai/chat/turns/${TURN}/tool-results`, (route) =>
    route.fulfill({ status: 202, json: { accepted: true } })
  )
}

function distanceFromEnd(page: Page) {
  return page
    .getByRole('region', { name: 'Conversation' })
    .evaluate((viewport) => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight)
}

test.describe.configure({ timeout: 180_000 })

test.beforeEach(() => {
  const chatConfig = test.info().config.configFile?.endsWith('playwright.chat.config.ts') ?? false
  test.skip(!chatConfig, 'runs under pnpm test:e2e:chat, where the server has ai.chat on')
})

test('the conversation follows a streaming reply to the end', async ({ page }) => {
  await ensureAuthed(page)
  await mockChat(page)
  await page.goto(`/chat/${THREAD}`)
  await expect(page.getByText('Answer 8.')).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(40)

  await page.getByRole('textbox').last().fill('Keep going')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Streamed line 39.')).toBeAttached({ timeout: 30_000 })
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(40)
})

test('a conversation opened with its first reply still streaming follows it', async ({ page }) => {
  await ensureAuthed(page)
  await mockChat(page, [runningTurn()])
  await page.goto(`/chat/${THREAD}`)
  await expect(page.getByText('Streamed line 39.')).toBeAttached({ timeout: 60_000 })
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(40)
})

test('the conversation follows a reply that shows tool cards', async ({ page }) => {
  await ensureAuthed(page)
  await mockChat(page, undefined, 'tools')
  await page.goto(`/chat/${THREAD}`)
  await expect(page.getByText('Answer 8.')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('textbox').last().fill('Search')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Streamed line 39.')).toBeAttached({ timeout: 30_000 })
  await page.waitForTimeout(2_000)
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(40)
})

test('sending a message brings the conversation back to the end after reading further up', async ({ page }) => {
  await ensureAuthed(page)
  await mockChat(page)
  await page.goto(`/chat/${THREAD}`)
  await expect(page.getByText('Answer 8.')).toBeVisible({ timeout: 60_000 })
  const viewport = page.getByRole('region', { name: 'Conversation' })
  await viewport.hover()
  await page.mouse.wheel(0, -1_500)
  await expect.poll(() => distanceFromEnd(page)).toBeGreaterThan(400)
  await page.getByRole('textbox').last().fill('Keep going')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Streamed line 39.')).toBeAttached({ timeout: 30_000 })
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(40)
})
