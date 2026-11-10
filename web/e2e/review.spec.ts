import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { reviewPayload } from '../src/test/review-fixture'
import { match } from '../src/test/league-fixture'

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

  await timeline.getByLabel('Timeline settings (setup needed)').click()
  await timeline.getByRole('button', { name: 'Attach game' }).click()
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
  await timeline.getByLabel('Timeline settings', { exact: true }).click()
  await expect(timeline.getByText('10:00 at 1:00 in the video')).toBeVisible()
  await timeline.getByLabel('Timeline settings', { exact: true }).click()
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
  // The whole player, seek controls included, fits in the window.
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
  await page.getByRole('button', { name: 'Back 30 seconds' }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await page
    .getByRole('group', { name: 'Video seek controls' })
    .screenshot({ path: testInfo.outputPath('seek-controls.png') })
  await page.getByRole('button', { name: 'Hide timeline' }).click()
  await expect(timeline).toHaveCount(0)
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
  await expect(guestTimeline.getByLabel(/Timeline settings/)).toHaveCount(0)
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('review-tall-timeline-mobile.png'),
    fullPage: true,
  })
})
