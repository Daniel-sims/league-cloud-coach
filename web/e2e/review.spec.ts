import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { reviewPayload } from '../src/test/review-fixture'
import { match } from '../src/test/league-fixture'
import { readFileSync } from 'node:fs'
import type { ReviewCapture } from '../src/lib/review'

// Simulated-backend contract test for the review timeline. Real permissions are
// covered by supabase/tests/review-security.sql; this is not a live login.
const ownerId = '11111111-1111-4111-8111-111111111111'
const recordingId = '44444444-4444-4444-8444-444444444444'
const token = 'b'.repeat(64)
const user = {
  id: ownerId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.test',
  app_metadata: { provider: 'google' },
  user_metadata: { full_name: 'Library Owner' },
  created_at: '2026-11-09T00:00:00Z',
}
type Comment = {
  id: string
  videoMs: number
  kind: string
  body: string
  role: string
  author: string | null
  key?: string
}
type State = {
  review: ReturnType<typeof reviewPayload> | null
  anchor: { gameTimeSeconds: number; videoOffsetSeconds: number } | null
  comments: Comment[]
  calls: { name: string; args: Record<string, unknown> }[]
  captures?: (ReviewCapture & { image: string; key?: string })[]
  failCaptureSave?: boolean
}

// A disposable silent WAV gives the real video element a 120-second timeline.
const samples = 120 * 8000
const wav = Buffer.alloc(44 + samples, 128)
wav.write('RIFF', 0)
wav.writeUInt32LE(36 + samples, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24)
wav.writeUInt32LE(8000, 28)
wav.writeUInt16LE(1, 32)
wav.writeUInt16LE(8, 34)
wav.write('data', 36)
wav.writeUInt32LE(samples, 40)

async function mock(context: BrowserContext, state: State, owner: boolean) {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'MediaSource', { value: undefined, configurable: true })
    Object.defineProperty(window, 'ManagedMediaSource', { value: undefined, configurable: true })
    const original = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type === 'application/vnd.apple.mpegurl' ? 'maybe' : original.call(this, type)
    }
  })
  await context.route('https://customer-test.cloudflarestream.com/review.wav', (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'audio/wav',
      body: wav.subarray(start, end + 1),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}),
      },
    })
  })
  await context.route('https://cloud-coach-test.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!
    const args = route.request().postDataJSON() || {}
    state.calls.push({ name, args })
    const view = (mineKey: string | null) => ({
      matchId: state.review ? 'EUW1_1' : null,
      review: state.review,
      syncedAt: null,
      anchor: state.anchor,
      comments: state.comments
        .map(({ key, ...c }) => ({
          ...c,
          mine: mineKey === null ? c.role === 'owner' : key === mineKey,
          createdAt: '2026-11-10T10:00:00Z',
          updatedAt: '2026-11-10T10:00:00Z',
        }))
        .sort((a, b) => a.videoMs - b.videoMs),
    })
    let result: unknown = null
    if (name === 'list_recording_captures')
      result = (state.captures ?? []).map(({ image: _image, key, ...capture }) => ({
        ...capture,
        mine: args.p_token ? key === args.p_author_key : capture.role === 'owner',
      }))
    if (name === 'get_recording_capture')
      result = state.captures?.find((capture) => capture.id === args.p_capture)?.image
    if (name === 'add_recording_capture') {
      if (state.failCaptureSave)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'The capture could not save. Try again.',
            code: '22023',
          }),
        })
      const id = `capture-${(state.captures?.length ?? 0) + 1}`
      state.captures ??= []
      state.captures.push({
        id,
        videoMs: Number(args.p_video_ms),
        image: String(args.p_image),
        body: String(args.p_body),
        role: args.p_token ? 'coach' : 'owner',
        author: (args.p_author_name as string) ?? null,
        key: args.p_author_key as string,
        mine: true,
        createdAt: new Date().toISOString(),
      })
      result = id
    }
    if (name === 'delete_recording_capture')
      state.captures = state.captures?.filter((capture) => capture.id !== args.p_capture)
    if (name === 'user') result = owner ? user : null
    if (name === 'is_library_owner') result = owner
    if (name === 'list_companions') result = []
    if (name === 'list_recordings')
      result = [
        {
          id: recordingId,
          title: 'Ranked mid review',
          youtube_video_id: null,
          provider: 'stream',
          stream_video_id: 'd'.repeat(32),
          recorded_on: '2026-11-09',
          created_at: '2026-11-09T19:00:00Z',
          has_share: true,
        },
      ]
    if (name === 'stream') {
      if (args.action === 'upload-sync') result = { imported: 0, pending: [] }
      else
        result = {
          url: 'https://customer-test.cloudflarestream.com/review.wav',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          sessionExpiresAt:
            args.action === 'owner' ? null : new Date(Date.now() + 7200000).toISOString(),
        }
    }
    if (name === 'resolve_recording_share')
      result = [
        {
          title: 'Ranked mid review',
          youtube_video_id: null,
          recorded_on: '2026-11-09',
          provider: 'stream',
          stream_video_id: 'd'.repeat(32),
          session_expires_at: null,
        },
      ]
    if (name === 'list_league_profiles')
      result = [
        {
          id: 'profile',
          platform: 'euw1',
          puuid: 'me',
          gameName: 'Owner',
          tagLine: 'EUW',
          profileIconId: 1,
          summonerLevel: 300,
          ranks: [],
          syncedAt: null,
        },
      ]
    if (name === 'list_league_matches')
      result = [
        match('1', {}, { id: 'EUW1_1', gameCreation: Date.parse('2026-11-09T18:30:00Z') }),
        match('2', { win: false }, { gameCreation: Date.parse('2026-11-07T18:00:00Z') }),
      ]
    if (name === 'riot' && args.action === 'review-timeline') {
      state.review = reviewPayload()
      result = { ok: true }
    }
    if (name === 'get_recording_review') result = view(null)
    if (name === 'get_shared_review') result = view(String(args.p_author_key))
    if (name === 'set_recording_anchor')
      state.anchor =
        args.p_game_time === null
          ? null
          : {
              gameTimeSeconds: Number(args.p_game_time),
              videoOffsetSeconds: Number(args.p_video_offset),
            }
    if (name === 'add_recording_comment' || name === 'add_shared_comment') {
      const id = `c${state.comments.length + 1}`
      state.comments.push({
        id,
        videoMs: Number(args.p_video_ms),
        kind: String(args.p_kind),
        body: String(args.p_body),
        role: name === 'add_recording_comment' ? 'owner' : 'coach',
        author: name === 'add_shared_comment' ? String(args.p_author_name) : null,
        key: args.p_author_key as string | undefined,
      })
      result = id
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}
async function signIn(context: BrowserContext) {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ownerId, exp: expires, role: 'authenticated' })).toString('base64url')}.test-signature`
  await context.addInitScript(
    ({ session }) =>
      localStorage.setItem('sb-cloud-coach-test-auth-token', JSON.stringify(session)),
    {
      session: {
        access_token: accessToken,
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expires,
        user,
      },
    },
  )
}
const inList = (row: ReturnType<Page['locator']>) =>
  row.evaluate((element) => {
    const list = element.closest('ol')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return box.top >= list.top - 1 && box.bottom <= list.bottom + 1
  })
async function seekVideo(page: Page, label: string, seconds: number) {
  const video = page.getByLabel(label, { exact: true })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBe(120)
  await video.evaluate((v: HTMLVideoElement, s) => (v.currentTime = s), seconds)
  return video
}

test('owner attaches the game, syncs the clock and comments; a signed-out coach sees it and replies', async ({
  page,
  browser,
}, testInfo) => {
  const state: State = { review: null, anchor: null, comments: [], calls: [] }
  await mock(page.context(), state, true)
  await signIn(page.context())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/#/video/${recordingId}`)
  const timeline = page.getByRole('region', { name: 'Review timeline' })
  await expect(timeline.getByText('No comments yet')).toBeVisible()

  await page.getByLabel('Video settings (setup needed)').click()
  await page.getByRole('button', { name: 'Attach game' }).click()
  const attach = page.getByRole('dialog')
  // The only synced game on the recording date is preselected.
  await expect(attach.getByRole('radio', { checked: true })).toHaveValue('EUW1_1')
  await attach.getByRole('button', { name: 'Attach game' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.calls.find((c) => c.name === 'riot')!.args).toMatchObject({
    action: 'review-timeline',
    recordingId,
    profileId: 'profile',
    matchId: 'EUW1_1',
  })

  const video = await seekVideo(page, 'Ranked mid review', 60)
  // Clicking an event before the clock is synced asks for the in-game time, then jumps there.
  await timeline.getByText('Mid lane', { exact: true }).click()
  const sync = timeline.getByRole('form', { name: 'Sync game clock' })
  await expect(sync).toContainText('jumps to the 10:00 event')
  // Nothing covers the video while syncing: the frame's timer has to stay readable.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await sync.getByLabel('In-game clock').fill('10:00')
  await page.screenshot({ path: testInfo.outputPath('sync-inline.png') })
  await sync.getByRole('button', { name: 'Sync', exact: true }).click()
  // 10:00 fight sits at video 1:00; it seeks exactly there.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(60)
  await page.getByLabel('Video settings', { exact: true }).click()
  await expect(page.getByText('10:00 at 1:00 in the video')).toBeVisible()
  await page.getByLabel('Video settings', { exact: true }).click()
  await expect(timeline.getByRole('button', { name: 'Killed Ahri', exact: true })).toBeDisabled()

  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 70))
  await page.locator('body').press('n')
  await expect(timeline.getByText('New at 10:10')).toBeVisible()
  await timeline.getByRole('radio', { name: 'Question' }).check()
  await timeline.getByLabel('Comment text').fill('Should I have backed before this fight?')
  await timeline.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(timeline.getByText('Should I have backed before this fight?')).toBeVisible()
  expect(state.calls.find((c) => c.name === 'add_recording_comment')!.args).toMatchObject({
    p_video_ms: 70000,
    p_kind: 'question',
  })
  // The list follows the playhead to the row it most recently passed.
  await expect
    .poll(() => inList(timeline.getByRole('listitem').filter({ hasText: 'Should I have backed' })))
    .toBe(true)
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 80))
  await timeline
    .getByRole('button', { name: 'Should I have backed before this fight?', exact: true })
    .click()
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(70)
  await page.screenshot({ path: testInfo.outputPath('review-owner-desktop.png'), fullPage: true })
  await timeline
    .locator('.matchup-card')
    .last()
    .screenshot({ path: testInfo.outputPath('matchup-light.png') })
  // Collapsing the sidebar gives the video the width; the choice survives reload.
  const before = await video.evaluate((v) => v.getBoundingClientRect().width)
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(page.locator('#app-sidebar')).toBeHidden()
  await expect
    .poll(() => video.evaluate((v) => v.getBoundingClientRect().width))
    .toBeGreaterThan(before)
  await page.setViewportSize({ width: 1903, height: 958 })
  await page.waitForTimeout(100)
  const stage = await video.evaluate((v) => v.parentElement!.getBoundingClientRect())
  const wrap = await video.evaluate((v) => v.closest('.player-wrap')!.getBoundingClientRect())
  const panel = await timeline.boundingBox()
  // The compact header leaves the player at 100px; no extra transport rows.
  expect(stage.y).toBeLessThanOrEqual(100)
  expect(wrap.bottom).toBeLessThanOrEqual(958)
  expect(Math.abs(panel!.y + panel!.height - (958 - 24))).toBeLessThan(2)
  expect(Math.round((stage.width / stage.height) * 9)).toBe(16)
  expect(panel!.x).toBeGreaterThan(stage.right)
  await page.screenshot({ path: testInfo.outputPath('review-owner-collapsed.png') })
  // Dragging the divider left widens the timeline; the width is remembered.
  const handle = page.getByRole('separator', { name: 'Resize timeline' })
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200)
  await page.mouse.down()
  await page.mouse.move(grip.x - 150, grip.y + 200, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(async () => (await timeline.boundingBox())!.width)
    .toBeGreaterThan(panel!.width + 140)
  expect(
    await page.evaluate(() => Number(localStorage.getItem('league-cloud-coach-timeline-width'))),
  ).toBeGreaterThan(panel!.width + 140)
  await expect(page.getByRole('group', { name: 'Video seek controls' })).toHaveCount(0)
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
  await page.keyboard.press('Space')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await page.getByRole('button', { name: 'Hide timeline' }).click()
  await expect(timeline).toHaveCount(0)
  await page.getByLabel('Video settings', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible()
  await page.getByLabel('Video settings', { exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('review-timeline-hidden.png') })
  await page.getByRole('button', { name: 'Show timeline' }).click()
  await expect(timeline).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await mock(guestContext, state, false)
  const guest = await guestContext.newPage()
  await guest.goto(`/#/watch/${token}`)
  await guest.getByRole('button', { name: 'Start session' }).click()
  const guestTimeline = guest.getByRole('region', { name: 'Review timeline' })
  const question = guestTimeline.getByRole('listitem').filter({ hasText: 'Should I have backed' })
  await expect(question.getByText('Player')).toBeVisible()
  await expect(question.getByRole('button', { name: 'Edit comment' })).toHaveCount(0)
  await guest.getByLabel(/Video settings/).click()
  await expect(guest.getByRole('radiogroup', { name: 'Timeline detail' })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Change game' })).toHaveCount(0)
  await guest.getByLabel(/Video settings/).click()
  await expect(guest.getByRole('button', { name: 'Draw', exact: true })).toBeVisible()
  await expect(guestTimeline.getByRole('button', { name: 'Sync clock' })).toHaveCount(0)
  await seekVideo(guest, 'Ranked mid review', 72)
  await guestTimeline.getByRole('button', { name: 'Comment', exact: true }).click()
  await guestTimeline.getByLabel('Your name').fill('Coach Sam')
  await guestTimeline.getByLabel('Comment text').fill('Yes — wave was crashing, base here.')
  await guestTimeline.getByRole('button', { name: 'Add', exact: true }).click()
  const reply = guestTimeline.getByRole('listitem').filter({ hasText: 'wave was crashing' })
  await expect(reply.getByText('You')).toBeVisible()
  await expect(reply.getByRole('button', { name: 'Edit comment' })).toBeVisible()
  await expect.poll(() => inList(reply)).toBe(true)
  expect(state.calls.find((c) => c.name === 'add_shared_comment')!.args).toMatchObject({
    p_token: token,
    p_author_name: 'Coach Sam',
    p_video_ms: 72000,
  })
  await guest.screenshot({ path: testInfo.outputPath('review-coach-mobile.png'), fullPage: true })

  await page.evaluate(() => localStorage.setItem('league-cloud-coach-theme', 'dark'))
  await page.reload()
  const coachRow = page
    .getByRole('region', { name: 'Review timeline' })
    .getByRole('listitem')
    .filter({ hasText: 'wave was crashing' })
  await expect(coachRow.getByText('Coach Sam')).toBeVisible()
  await expect(coachRow.getByRole('button', { name: 'Delete comment' })).toBeVisible()
  await expect(coachRow.getByRole('button', { name: 'Edit comment' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('review-owner-dark.png'), fullPage: true })
  await page
    .getByRole('region', { name: 'Review timeline' })
    .locator('.matchup-card')
    .first()
    .screenshot({ path: testInfo.outputPath('matchup-dark.png') })
  await guestContext.close()
})

test('companion approval is explicit and imported ultimate markers seek for a signed-out coach', async ({
  page,
  browser,
}, testInfo) => {
  const hash = 'a'.repeat(64)
  const state: State = {
    review: reviewPayload(),
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 10 },
    comments: [],
    calls: [],
  }
  state.review!.ultimates = { detectorVersion: 1, videoTimestampsMs: [40000] }
  await mock(page.context(), state, true)
  await signIn(page.context())
  await page.goto(`/#/connect/${hash}`)
  await expect(
    page.getByRole('heading', { name: 'Connect League Helper', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('AAAAAAAA', { exact: true })).toBeVisible()
  expect(state.calls.some((c) => c.name === 'connect_companion')).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('companion-approval.png'), fullPage: true })
  await page.getByRole('button', { name: 'Connect League Helper', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Return to League Helper')
  expect(state.calls.find((c) => c.name === 'connect_companion')?.args).toEqual({ p_hash: hash })
  const coach = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await mock(coach, state, false)
  const watch = await coach.newPage()
  await watch.goto(`/#/watch/${token}`)
  await watch.getByRole('button', { name: 'Start session', exact: true }).click()
  const marker = watch.getByRole('button', { name: 'Cast ultimate', exact: true })
  await expect(marker).toBeEnabled()
  await marker.click()
  const video = watch.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(35, 0)
  await watch.screenshot({ path: testInfo.outputPath('ultimate-marker.png'), fullPage: true })
  await coach.close()
})

async function expectHeaderMenuFits(page: Page, label: RegExp) {
  const toggle = page.getByLabel(label)
  await toggle.click()
  const menu = page.locator('.review-menu-panel')
  const bounds = (await menu.boundingBox())!
  const containerBounds = await menu.evaluate((element) => {
    const parent = element.closest('.review-video, .review-panel')!
    const box = parent.getBoundingClientRect()
    return { left: box.left, right: box.right }
  })
  expect(bounds.x).toBeGreaterThanOrEqual(containerBounds.left)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(containerBounds.right)
  expect(
    await menu.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return [box.left + 2, box.right - 2].every((x) =>
        element.contains(document.elementFromPoint(x, box.top + 20)),
      )
    }),
  ).toBe(true)
  await toggle.click()
}

async function expectOneHeaderMenu(page: Page) {
  const settings = page.getByLabel(/Video settings/)
  const filter = page.getByLabel(/Filter timeline/)
  await settings.click()
  // On stacked mobile layouts the open tools menu can overlap the timeline.
  await page.getByRole('heading', { name: 'Ranked mid review', exact: true }).click()
  await expect(page.locator('.review-menu-panel')).toHaveCount(0)
  await filter.click()
  await expect(page.locator('.review-menu-panel')).toHaveCount(1)
  await expect(page.locator('.review-settings-menu')).toHaveCount(0)
  await settings.click()
  await expect(page.locator('.review-menu-panel')).toHaveCount(1)
  await expect(page.locator('.review-settings-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.review-menu-panel')).toHaveCount(0)
  await expect(settings).toBeFocused()
}

test('desktop timeline fills the available window independently of the video height', async ({
  page,
}, testInfo) => {
  const state: State = {
    review: reviewPayload(),
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 10 },
    comments: [],
    calls: [],
  }
  await mock(page.context(), state, true)
  await signIn(page.context())
  await page.addInitScript(() => localStorage.setItem('league-cloud-coach-theme', 'dark'))
  await page.setViewportSize({ width: 2048, height: 1126 })
  await page.goto(`/#/video/${recordingId}`)
  const timeline = page.getByRole('region', { name: 'Review timeline' })
  const video = await seekVideo(page, 'Ranked mid review', 30)
  const wrap = page.locator('.review-video .player-wrap')
  await expect
    .poll(async () => {
      const box = (await timeline.boundingBox())!
      return Math.abs(box.y + box.height - (1126 - 24))
    })
    .toBeLessThan(2)
  const initial = (await timeline.boundingBox())!
  expect(initial.height).toBeGreaterThan((await wrap.boundingBox())!.height + 100)
  expect(
    await video.evaluate((v) =>
      Math.round(
        (v.parentElement!.getBoundingClientRect().width /
          v.parentElement!.getBoundingClientRect().height) *
          9,
      ),
    ),
  ).toBe(16)
  await page.screenshot({
    path: testInfo.outputPath('review-tall-timeline-desktop.png'),
    fullPage: true,
  })
  await page.evaluate(() => localStorage.setItem('league-cloud-coach-timeline-width', '300'))
  await page.reload()
  await seekVideo(page, 'Ranked mid review', 30)
  await expectHeaderMenuFits(page, /Video settings/)
  await expectHeaderMenuFits(page, /Filter timeline/)
  await expectOneHeaderMenu(page)
  await page.getByLabel(/Video settings/).click()
  await page.screenshot({ path: testInfo.outputPath('settings-narrow-desktop.png') })
  await page.getByLabel(/Video settings/).click()
  await page.setViewportSize({ width: 2048, height: 820 })
  await expect
    .poll(async () => {
      const box = (await timeline.boundingBox())!
      return Math.abs(box.y + box.height - (820 - 24))
    })
    .toBeLessThan(2)
  expect((await timeline.boundingBox())!.height).toBeLessThan(initial.height - 300)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(async () => Math.abs((await timeline.boundingBox())!.height - 844 * 0.75))
    .toBeLessThan(2)
  expect((await timeline.boundingBox())!.y).toBeGreaterThan(
    (await wrap.boundingBox())!.y + (await wrap.boundingBox())!.height,
  )
  await expectHeaderMenuFits(page, /Video settings/)
  await expectHeaderMenuFits(page, /Filter timeline/)
  await expectOneHeaderMenu(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByLabel(/Video settings/).click()
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') })
  await page.getByLabel(/Video settings/).click()
  await page.screenshot({
    path: testInfo.outputPath('review-tall-timeline-mobile.png'),
    fullPage: true,
  })
})

async function drawingVideo(context: BrowserContext) {
  const fixture = Buffer.from(
    readFileSync(new URL('./fixtures/drawing.mp4.base64', import.meta.url), 'utf8').trim(),
    'base64',
  )
  await context.route('https://customer-test.cloudflarestream.com/review.wav', (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), fixture.length - 1) : fixture.length - 1
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/mp4',
      body: fixture.subarray(start, end + 1),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${fixture.length}` } : {}),
      },
    })
  })
}

async function expectReadableCapture(page: Page) {
  const row = page.locator('.kind-capture').first()
  await row.scrollIntoViewIfNeeded()
  const layout = await row.evaluate((element) => {
    const time = element.querySelector('.timeline-time')!.textContent
    const body = element.querySelector('.timeline-body')!.getBoundingClientRect()
    const title = element.querySelector('.timeline-label')!.getBoundingClientRect()
    return { time, bodyWidth: body.width, titleWidth: title.width, titleHeight: title.height }
  })
  expect(layout.time).toMatch(/\d+:\d{2}/)
  expect(layout.bodyWidth).toBeGreaterThan(150)
  expect(layout.titleWidth).toBeGreaterThan(80)
  expect(layout.titleHeight).toBeLessThan(45)
}

test('drawing freezes a real frame, keeps failed saves, and persists a capture on the exact timeline timestamp', async ({
  page,
}, testInfo) => {
  const state: State = { review: null, anchor: null, comments: [], captures: [], calls: [] }
  await mock(page.context(), state, true)
  await drawingVideo(page.context())
  await signIn(page.context())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/#/video/${recordingId}`)
  const video = page.getByLabel('Ranked mid review', { exact: true })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640)
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2)
  await video.evaluate(async (v: HTMLVideoElement) => {
    const seeked = new Promise<void>((resolve) =>
      v.addEventListener('seeked', () => resolve(), { once: true }),
    )
    v.currentTime = 1.125
    await seeked
    await v.play()
  })
  await page.getByRole('button', { name: 'Draw', exact: true }).click()
  const editor = page.getByRole('dialog', { name: /^Draw at/ })
  await expect(editor.getByAltText('Frozen video frame')).toBeVisible()
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  const frozenTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
  const canvas = editor.locator('canvas')
  const box = (await canvas.boundingBox())!
  await editor.getByRole('button', { name: 'Red', exact: true }).click()
  const sidebar = (await editor
    .getByRole('complementary', { name: 'Drawing controls and notes' })
    .boundingBox())!
  expect(box.width).toBeGreaterThan(1000)
  expect(sidebar.x).toBeGreaterThanOrEqual(box.x + box.width)
  const opacity = editor.getByRole('slider', { name: 'Ink opacity' })
  await opacity.focus()
  await opacity.press('Home')
  for (let i = 0; i < 10; i++) await opacity.press('ArrowRight')
  await expect(opacity).toHaveValue('50')
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.25, { steps: 10 })
  await page.mouse.up()
  const partialAlpha = () =>
    canvas.evaluate(
      (c: HTMLCanvasElement) =>
        c.getContext('2d')!.getImageData(c.width / 2, Math.floor(c.height * 0.25), 1, 1).data[3],
    )
  expect(await partialAlpha()).toBeGreaterThanOrEqual(126)
  expect(await partialAlpha()).toBeLessThanOrEqual(129)
  await opacity.press('End')
  await editor.getByLabel('Width').selectOption('8')
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.35, { steps: 20 })
  await page.mouse.up()
  const hasInk = () =>
    canvas.evaluate(
      (c: HTMLCanvasElement) =>
        c.getContext('2d')!.getImageData(c.width / 2, Math.floor(c.height * 0.35), 1, 1).data[3] >
        0,
    )
  expect(await hasInk()).toBe(true)
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await hasInk()).toBe(false)
  await editor.getByRole('button', { name: 'Redo', exact: true }).click()
  expect(await hasInk()).toBe(true)
  await editor.getByRole('button', { name: 'Clear drawing', exact: true }).click()
  expect(await hasInk()).toBe(false)
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await hasInk()).toBe(true)
  // Erasing removes ink without erasing the underlying video frame.
  await editor.getByRole('button', { name: 'Eraser', exact: true }).click()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.35)
  expect(await hasInk()).toBe(false)
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await partialAlpha()).toBeGreaterThanOrEqual(126)
  expect(await partialAlpha()).toBeLessThanOrEqual(129)
  await editor.getByRole('button', { name: 'Pen', exact: true }).click()
  await editor.getByLabel('Note (optional)').fill('Hold this position')
  await page.screenshot({ path: testInfo.outputPath('drawing-editor.png') })
  state.failCaptureSave = true
  await editor.getByRole('button', { name: 'Capture to timeline' }).click()
  await expect(editor.getByRole('alert')).toContainText('could not save')
  await expect(editor.getByLabel('Note (optional)')).toHaveValue('Hold this position')
  expect(await hasInk()).toBe(true)
  state.failCaptureSave = false
  await editor.getByRole('button', { name: 'Capture to timeline' }).click()
  await expect(editor).toHaveCount(0)
  expect(state.captures).toHaveLength(1)
  expect(state.captures![0].videoMs).toBe(Math.round(frozenTime * 1000))
  expect(Buffer.from(state.captures![0].image.split(',')[1], 'base64').length).toBeLessThanOrEqual(
    262144,
  )
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await expect(page.getByAltText('Annotated frame thumbnail')).toBeVisible()
  await expectReadableCapture(page)
  await page.getByRole('button', { name: /Drawing capture/ }).click()
  const preview = page.getByRole('dialog', { name: /^Capture at/ })
  await expect(preview.getByAltText('Hold this position')).toBeVisible()
  // The persisted JPEG contains the red line, not just the original video.
  const pixel = await preview.getByRole('img').evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return [...ctx.getImageData(c.width / 2, Math.floor(c.height * 0.35), 1, 1).data]
  })
  expect(pixel[0]).toBeGreaterThan(180)
  expect(pixel[1]).toBeLessThan(110)
  await preview.getByRole('button', { name: 'Jump to video' }).click()
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => Math.round(v.currentTime * 1000)))
    .toBe(state.captures![0].videoMs)
  await page.reload()
  await expect(page.getByAltText('Annotated frame thumbnail')).toBeVisible()
  await page.evaluate(() => localStorage.setItem('league-cloud-coach-timeline-width', '300'))
  await page.reload()
  await expectReadableCapture(page)
  await page.screenshot({ path: testInfo.outputPath('capture-row-narrow-desktop.png') })
  await page.getByRole('button', { name: /Drawing capture/ }).click()
  await page.getByRole('button', { name: 'Delete capture' }).click()
  await expect(page.getByRole('button', { name: /Drawing capture/ })).toHaveCount(0)
})

test('signed-out coaches can draw, capture and delete their own stills while player captures remain read-only', async ({
  page,
}, testInfo) => {
  const state: State = { review: null, anchor: null, comments: [], captures: [], calls: [] }
  await mock(page.context(), state, false)
  await drawingVideo(page.context())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#/watch/${token}`)
  await page.getByRole('button', { name: 'Start session' }).click()
  const video = page.getByLabel('Ranked mid review', { exact: true })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640)
  await page.getByRole('button', { name: 'Draw', exact: true }).click()
  const editor = page.getByRole('dialog', { name: /^Draw at/ })
  await expect(editor.getByAltText('Frozen video frame')).toBeVisible()
  await editor.getByLabel('Your name').fill('Coach')
  await editor.getByRole('button', { name: 'Arrow', exact: true }).click()
  await editor.getByRole('button', { name: 'Blue', exact: true }).click()
  await editor.locator('canvas').scrollIntoViewIfNeeded()
  const canvas = (await editor.locator('canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width * 0.2, canvas.y + canvas.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.6)
  await page.mouse.up()
  await editor.getByLabel('Note (optional)').fill('Move toward the river')
  await page.screenshot({ path: testInfo.outputPath('drawing-mobile.png') })
  await editor.getByRole('button', { name: 'Capture to timeline' }).click()
  await expect(editor).toHaveCount(0)
  expect(state.captures![0].role).toBe('coach')
  expect(state.captures![0].author).toBe('Coach')
  await expectReadableCapture(page)
  await page.screenshot({ path: testInfo.outputPath('capture-row-mobile.png') })
  await page.getByRole('button', { name: /Drawing capture/ }).click()
  await expect(page.getByRole('button', { name: 'Delete capture' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  // Return the same persisted still as a player's capture to exercise guest moderation UI.
  state.captures![0].role = 'owner'
  state.captures![0].key = undefined
  await page.reload()
  await page.getByRole('button', { name: /Drawing capture/ }).click()
  await expect(page.getByRole('button', { name: 'Delete capture' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const owner of [true, false]) {
  test(`cinema mode keeps video and timeline for ${owner ? 'owners' : 'shared viewers'}`, async ({
    page,
  }, testInfo) => {
    const state: State = {
      review: reviewPayload(),
      anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 10 },
      comments: [],
      calls: [],
    }
    await mock(page.context(), state, owner)
    if (owner) {
      await signIn(page.context())
      await page.addInitScript(() =>
        localStorage.setItem('league-cloud-coach-sidebar', 'collapsed'),
      )
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(owner ? `/#/video/${recordingId}` : `/#/watch/${token}`)
    if (!owner) await page.getByRole('button', { name: 'Start session' }).click()
    const video = await seekVideo(page, 'Ranked mid review', 30)
    const originalVideo = await video.elementHandle()
    await page.getByRole('button', { name: 'Enter cinema mode' }).click()
    await expect(
      page
        .locator('.topbar, .sidebar, .watch-header, .video-bar, .watch-footer')
        .filter({ visible: true }),
    ).toHaveCount(0)
    const timeline = page.getByRole('region', { name: 'Review timeline' })
    await expect(timeline).toBeVisible()
    await expect(timeline.getByRole('button', { name: 'Exit cinema mode' })).toBeVisible()
    await expect(
      page.locator('.review-video').getByRole('button', { name: 'Draw', exact: true }),
    ).toBeVisible()
    const panel = (await timeline.boundingBox())!
    expect(panel.y).toBe(0)
    expect(panel.y + panel.height).toBe(900)
    expect(panel.x + panel.width).toBe(1440)
    const videoColumn = (await page.locator('.review-video').boundingBox())!
    const playerBounds = (await page.locator('.review-video .player-wrap').boundingBox())!
    expect(videoColumn.x).toBe(0)
    expect(videoColumn.width).toBe(panel.x)
    expect(Math.abs(playerBounds.y + playerBounds.height / 2 - 450)).toBeLessThan(1)
    expect(playerBounds.x).toBe(0)
    expect(playerBounds.width).toBe(videoColumn.width)
    expect(
      await page.locator('.player-stage').evaluate((element) => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, radius: style.borderRadius }
      }),
    ).toEqual({ background: 'rgb(0, 0, 0)', radius: '0px' })
    expect(await video.evaluate((v, original) => v === original, originalVideo)).toBe(true)
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(30)
    await page.getByLabel(owner ? /Video settings/ : /Filter timeline/).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Exit cinema mode' })).toBeVisible()
    await expect(page.locator('.review-menu-panel')).toHaveCount(0)
    if (owner) {
      await page.getByLabel(/Video settings/).click()
      await page.getByRole('button', { name: 'Change game', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Exit cinema mode' })).toBeVisible()
    }
    await page.screenshot({ path: testInfo.outputPath('cinema-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: 'Exit cinema mode' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(
      page.locator('.sidebar, .topbar, .watch-header').filter({ visible: true }),
    ).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('cinema-mobile.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Enter cinema mode' })).toBeFocused()
    await expect(page.locator(owner ? '.topbar' : '.watch-header')).toBeVisible()
    await page.getByRole('button', { name: 'Enter cinema mode' }).click()
    await page.getByRole('button', { name: 'Exit cinema mode' }).click()
    await expect(page.locator(owner ? '.topbar' : '.watch-header')).toBeVisible()
  })
}
