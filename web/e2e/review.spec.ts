import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { reviewPayload } from '../src/test/review-fixture'
import { match } from '../src/test/league-fixture'
import { readFileSync } from 'node:fs'
import type { ReviewCapture, CommentEvent } from '../src/lib/review'

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
  event?: CommentEvent
  id: string
  videoMs: number
  kind: string
  body: string
  role: string
  author: string | null
  key?: string
}
type NotesRecord = {
  id: string
  role: 'owner' | 'coach'
  key?: string
  author: string | null
  body: string
  version: number
  published: string | null
  completedAt: string | null
}
type State = {
  notes?: NotesRecord[]
  failNotesSave?: boolean
  review: ReturnType<typeof reviewPayload> | null
  anchor: { gameTimeSeconds: number; videoOffsetSeconds: number } | null
  comments: Comment[]
  calls: { name: string; args: Record<string, unknown> }[]
  captures?: (ReviewCapture & { image: string; key?: string })[]
  failCaptureSave?: boolean
  failCommentSave?: boolean
  /** Use real MediaSource playback (hls.js) instead of the native-HLS stand-in. */
  mse?: boolean
  lease?: () => { url: string; expiresAt: string }
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
  if (!state.mse)
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
    const notesView = () => {
      const own = (note: NotesRecord) =>
        name.includes('recording_notes')
          ? note.role === 'owner'
          : note.role === 'coach' && note.key === args.p_author_key
      const draft = state.notes?.find(own)
      return {
        draft: draft ? { body: draft.body, version: draft.version, author: draft.author } : null,
        reviews: (state.notes ?? [])
          .filter((note) => note.published !== null)
          .map((note) => ({
            id: note.id,
            body: note.published,
            role: note.role,
            author: note.author,
            completedAt: note.completedAt,
            mine: own(note),
          })),
      }
    }
    let result: unknown = null
    if (name === 'get_recording_notes' || name === 'get_shared_notes') result = notesView()
    if (name === 'save_recording_notes' || name === 'save_shared_notes') {
      if (state.failNotesSave)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Could not save review notes. Your draft is still here.',
            code: '22023',
          }),
        })
      state.notes ??= []
      let note = state.notes.find((note) =>
        name === 'save_recording_notes'
          ? note.role === 'owner'
          : note.role === 'coach' && note.key === args.p_author_key,
      )
      if ((note?.version ?? 0) !== args.p_version)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'These notes changed in another tab.', code: '40001' }),
        })
      if (!note) {
        note = {
          id: `r${state.notes.length + 1}`,
          role: name === 'save_recording_notes' ? 'owner' : 'coach',
          key: args.p_author_key as string | undefined,
          author: (args.p_author_name as string) ?? null,
          body: '',
          version: 0,
          published: null,
          completedAt: null,
        }
        state.notes.push(note)
      }
      note.body = String(args.p_body)
      note.version++
      note.author = (args.p_author_name as string) ?? null
      if (args.p_complete) {
        note.published = note.body.trim()
        note.completedAt = new Date().toISOString()
      }
      result = notesView()
    }
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
      else if (state.lease) result = { ...state.lease(), sessionExpiresAt: null }
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
    if (
      [
        'add_recording_comment',
        'add_shared_comment',
        'add_recording_event_comment',
        'add_shared_event_comment',
      ].includes(name)
    ) {
      if (state.failCommentSave)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Could not save this comment. Try again.',
            code: '22023',
          }),
        })
      const id = `c${state.comments.length + 1}`
      state.comments.push({
        id,
        videoMs: Number(args.p_video_ms),
        kind: String(args.p_kind),
        body: String(args.p_body),
        role: name.startsWith('add_recording_') ? 'owner' : 'coach',
        author: name.startsWith('add_shared_') ? String(args.p_author_name) : null,
        event: args.p_event as CommentEvent | undefined,
        key: args.p_author_key as string | undefined,
      })
      result = id
    }
    if (name === 'update_recording_comment' || name === 'update_shared_comment') {
      const comment = state.comments.find((c) => c.id === args.p_comment)
      if (comment) {
        comment.body = String(args.p_body)
        comment.kind = String(args.p_kind)
      }
    }
    if (name === 'delete_recording_comment' || name === 'delete_shared_comment')
      state.comments = state.comments.filter((c) => c.id !== args.p_comment)
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
  // Reviews open with the sidebar hidden so the video gets the width; showing
  // it narrows the video.
  await expect(page.locator('#app-sidebar')).toBeHidden()
  const before = await video.evaluate((v) => v.getBoundingClientRect().width)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(page.locator('#app-sidebar')).toBeVisible()
  await expect
    .poll(() => video.evaluate((v) => v.getBoundingClientRect().width))
    .toBeLessThan(before)
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(page.locator('#app-sidebar')).toBeHidden()
  await expect
    .poll(() => video.evaluate((v) => v.getBoundingClientRect().width))
    .toBeCloseTo(before, -1)
  await page.setViewportSize({ width: 1903, height: 958 })
  await page.waitForTimeout(100)
  const stage = await video.evaluate((v) => v.parentElement!.getBoundingClientRect())
  const wrap = await video.evaluate((v) => v.closest('.player-wrap')!.getBoundingClientRect())
  const panel = await timeline.boundingBox()
  const top = await page.locator('.review-container').evaluate((e) => e.getBoundingClientRect().y)
  // The player is centred beside the full-height timeline without a card,
  // below the page heading, with our control bar in view.
  expect(stage.y).toBeGreaterThanOrEqual(top)
  expect(
    (await page.getByRole('group', { name: 'Player controls' }).boundingBox())!.y,
  ).toBeGreaterThanOrEqual(stage.y + stage.height - 1)
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
  // Arriving at a review always hides the sidebar, even if it was shown last time.
  const reviewUrl = page.url()
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await page.getByRole('link', { name: 'Video library' }).first().click()
  await expect(page).toHaveURL(/#\/library$/)
  await expect(page.getByRole('heading', { name: /Video library/ })).toBeVisible()
  await expect(page.locator('#app-sidebar')).toBeVisible()
  await page.goto(reviewUrl)
  await expect(page.locator('#app-sidebar')).toBeHidden()
  await page.getByRole('button', { name: 'Show sidebar' }).click()
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
  await guest
    .getByRole('group', { name: 'Player controls' })
    .getByRole('button', { name: 'Comment', exact: true })
    .click()
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
  const wrap = page.locator('.review-video .review-player')
  await expect
    .poll(async () => {
      const box = (await timeline.boundingBox())!
      return Math.abs(box.y + box.height - (1126 - 24))
    })
    .toBeLessThan(2)
  const initial = (await timeline.boundingBox())!
  const player = (await wrap.boundingBox())!
  // The player and its bar sit on the timeline's bottom edge.
  expect(Math.abs(player.y + player.height - (initial.y + initial.height))).toBeLessThan(2)
  expect(
    await page.locator('.player-stage').evaluate((element) => ({
      radius: getComputedStyle(element).borderRadius,
      background: getComputedStyle(element).backgroundColor,
    })),
  ).toEqual({ radius: '0px', background: 'rgb(0, 0, 0)' })
  const recalls = timeline.locator('.kind-recall')
  await expect(recalls.first()).toBeVisible()
  await expect(recalls.locator('img, .timeline-inventory, .timeline-detail')).toHaveCount(0)
  // The video grows to use the height; the timeline still spans the full column.
  const used = (await wrap.boundingBox())!.height
  expect(initial.height).toBeGreaterThanOrEqual(used - 1)
  expect(used).toBeGreaterThan(initial.height * 0.85)
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
  // A taller game-window capture fills its own aspect ratio without side bars.
  await video.evaluate((media: HTMLVideoElement) => {
    Object.defineProperty(media, 'videoWidth', { value: 1500, configurable: true })
    Object.defineProperty(media, 'videoHeight', { value: 1000, configurable: true })
    media.dispatchEvent(new Event('resize'))
  })
  await expect
    .poll(async () => {
      const bounds = (await page.locator('.player-stage').boundingBox())!
      return Math.abs(bounds.width / bounds.height - 1.5)
    })
    .toBeLessThan(0.01)
  const fitted = (await wrap.boundingBox())!
  const column = (await page.locator('.review-video').boundingBox())!
  // Sits on the column's bottom edge, centred across it.
  expect(Math.abs(fitted.y + fitted.height - (column.y + column.height))).toBeLessThan(2)
  expect(Math.abs(fitted.x + fitted.width / 2 - (column.x + column.width / 2))).toBeLessThan(2)
  expect(
    Math.min(Math.abs(fitted.height - column.height), Math.abs(fitted.width - column.width)),
  ).toBeLessThan(2)
  await page.screenshot({ path: testInfo.outputPath('review-intrinsic-aspect.png') })
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
  const row = page.locator('li.kind-capture').first()
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
    const playerBounds = (await page.locator('.review-video .review-player').boundingBox())!
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
    await expect(page.locator(owner ? '.video-bar' : '.watch-header')).toBeVisible()
    await page.getByRole('button', { name: 'Enter cinema mode' }).click()
    await page.getByRole('button', { name: 'Exit cinema mode' }).click()
    await expect(page.locator(owner ? '.video-bar' : '.watch-header')).toBeVisible()
  })
}

for (const owner of [true, false]) {
  test(`simple objective icons seek exactly for ${owner ? 'owners' : 'shared viewers'}`, async ({
    page,
  }, testInfo) => {
    const payload = reviewPayload()
    payload.monsters.push({
      t: 750000,
      killer: 7,
      team: 200,
      assists: [],
      type: 'BARON_NASHOR',
      subType: null,
    })
    const state: State = {
      review: payload,
      anchor: { gameTimeSeconds: 720, videoOffsetSeconds: 30 },
      comments: [],
      calls: [],
    }
    await mock(page.context(), state, owner)
    if (owner) await signIn(page.context())
    await page.goto(owner ? `/#/video/${recordingId}` : `/#/watch/${token}`)
    if (!owner) await page.getByRole('button', { name: 'Start session' }).click()
    const video = await seekVideo(page, 'Ranked mid review', 10)
    await page.getByLabel(/Video settings/).click()
    await page.getByRole('radio', { name: 'Simple', exact: true }).click()
    await page.keyboard.press('Escape')
    const panel = page.getByRole('region', { name: 'Review timeline' })
    await expect(panel.locator('.timeline-compact.kind-objective')).toHaveCount(2)
    await expect(panel.locator('.objective-card, .matchup-card')).toHaveCount(0)
    const dragon = panel.getByRole('button', {
      name: 'Infernal Drake taken by your team at 12:00',
      exact: true,
    })
    const baron = panel.getByRole('button', {
      name: 'Baron Nashor taken by the enemy team at 12:30',
      exact: true,
    })
    await expect(dragon.locator('img')).toHaveAttribute('src', /dragon_infernal.png$/)
    await expect(dragon).toHaveText('Infernal Drake')
    await expect(baron).toHaveText('Baron Nashor')
    await expect(panel.locator('.event-comment-button')).toHaveCount(0)
    await expect(baron.locator('img')).toHaveAttribute('src', /baron.png$/)
    await dragon.click()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(30)
    await baron.click()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(60)
    await baron.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Event actions' })
    await expect(menu.getByRole('menuitem', { name: 'Add comment' })).toBeVisible()
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await page.screenshot({ path: testInfo.outputPath('event-context-menu.png') })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(baron).toBeFocused()
    await baron.press('Shift+F10')
    await expect(menu.getByRole('menuitem', { name: 'Add comment' })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByLabel('Filter timeline', { exact: true }).click()
    await panel.getByRole('checkbox', { name: /Objectives/ }).uncheck()
    await expect(panel.locator('.timeline-compact.kind-objective')).toHaveCount(0)
    await panel.getByRole('checkbox', { name: /Objectives/ }).check()
    await page.keyboard.press('Escape')
    await expect(panel.locator('.timeline-compact.kind-objective')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('simple-objectives.png') })
  })
}

test('event discussions group player and coach comments at the event timestamp', async ({
  page,
  browser,
}, testInfo) => {
  const state: State = {
    review: reviewPayload(),
    anchor: { gameTimeSeconds: 720, videoOffsetSeconds: 30 },
    comments: [],
    calls: [],
  }
  await mock(page.context(), state, true)
  await signIn(page.context())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    if (localStorage.getItem('league-cloud-coach-hidden-kinds') === null)
      localStorage.setItem('league-cloud-coach-hidden-kinds', '["comments"]')
  })
  await page.goto(`/#/video/${recordingId}`)
  await seekVideo(page, 'Ranked mid review', 90)
  const addEventComment = async (target: Page) => {
    await target
      .locator('[data-item="objective-720000"] > .timeline-body > button')
      .first()
      .click({ button: 'right' })
    await target.getByRole('menuitem', { name: 'Add comment', exact: true }).click()
  }
  await addEventComment(page)
  const thread = page.getByRole('region', {
    name: 'Comments on Infernal Drake taken by your team at 12:00',
    exact: true,
  })
  await expect(thread.getByText('On Infernal Drake taken by your team')).toBeVisible()
  await thread.getByLabel('Comment text').fill('Should we contest this dragon?')
  state.failCommentSave = true
  await thread.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(thread.getByLabel('Comment text')).toHaveValue('Should we contest this dragon?')
  state.failCommentSave = false
  await thread.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(thread.getByText('Should we contest this dragon?', { exact: true })).toBeVisible()
  expect(state.comments[0].videoMs).toBe(30000)
  expect(state.comments[0].event).toEqual({
    id: 'objective-720000',
    matchId: 'EUW1_1',
    gameMs: 720000,
    label: 'Infernal Drake taken by your team',
  })
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await mock(guestContext, state, false)
  const guest = await guestContext.newPage()
  await guest.goto(`/#/watch/${token}`)
  await guest.getByRole('button', { name: 'Start session' }).click()
  await seekVideo(guest, 'Ranked mid review', 80)
  const guestThread = guest.getByRole('region', {
    name: 'Comments on Infernal Drake taken by your team at 12:00',
    exact: true,
  })
  await expect(
    guestThread.getByText('Should we contest this dragon?', { exact: true }),
  ).toBeVisible()
  await expect(guestThread.getByRole('button', { name: 'Edit comment' })).toHaveCount(0)
  await addEventComment(guest)
  await guestThread.getByPlaceholder('Shown with your comments').fill('Coach')
  await guestThread.getByLabel('Comment text').fill('Push mid first, then move together.')
  await guestThread.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    guestThread.getByText('Push mid first, then move together.', { exact: true }),
  ).toBeVisible()
  await expect(guestThread.getByRole('button', { name: 'Edit comment' })).toHaveCount(1)
  expect(state.comments[1].event).toEqual(state.comments[0].event)
  await guestThread.getByRole('button', { name: 'Edit comment' }).click()
  await guestThread
    .getByLabel('Comment text')
    .fill('Push mid first, then move together. Bring vision.')
  await guestThread.getByRole('button', { name: 'Save', exact: true }).click()
  expect(state.comments[1].event).toEqual(state.comments[0].event)
  await page.reload()
  await expect(
    thread.getByText('Push mid first, then move together. Bring vision.', { exact: true }),
  ).toBeVisible()
  await expect(thread.getByRole('button', { name: 'Delete comment' })).toHaveCount(2)
  await page.getByLabel(/Video settings/).click()
  await page.getByRole('radio', { name: 'Simple', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(thread.getByText('Should we contest this dragon?', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('event-discussion-desktop.png') })
  await guest.screenshot({
    path: testInfo.outputPath('event-discussion-mobile.png'),
    fullPage: true,
  })
  await guestContext.close()
})

test('running notes autosave privately, survive reload, and publish the polished review on completion', async ({
  page,
  browser,
}, testInfo) => {
  const state: State = {
    review: reviewPayload(),
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 0 },
    comments: [],
    calls: [],
  }
  await mock(page.context(), state, true)
  await signIn(page.context())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/#/video/${recordingId}`)
  const video = await seekVideo(page, 'Ranked mid review', 30)
  const originalVideo = await video.elementHandle()
  await video.evaluate((v: HTMLVideoElement) => v.play())
  await expect(page.getByRole('button', { name: 'Add review notes' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add notes', exact: true }).click()
  const notes = page.getByRole('region', { name: 'Review notes', exact: true })
  await notes.getByLabel('Running notes').fill('Push the wave before roaming.')
  await expect(notes.getByText('Private draft saved', { exact: true })).toBeVisible()
  expect(state.notes?.[0].published).toBeNull()
  expect(await video.evaluate((v, original) => v === original, originalVideo)).toBe(true)
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
  await page.reload()
  await page.getByRole('button', { name: 'Add notes', exact: true }).click()
  await expect(notes.getByLabel('Running notes')).toHaveValue('Push the wave before roaming.')
  await page.screenshot({ path: testInfo.outputPath('running-notes-desktop.png') })
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await mock(guestContext, state, false)
  const guest = await guestContext.newPage()
  await guest.goto(`/#/watch/${token}`)
  await guest.getByRole('button', { name: 'Add notes', exact: true }).click()
  const guestNotes = guest.getByRole('region', { name: 'Review notes', exact: true })
  await expect(guestNotes.getByLabel('Running notes')).toHaveValue('')
  await expect(guest.getByText('Push the wave before roaming.', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Complete review', exact: true }).first().click()
  const finish = page.getByRole('dialog', { name: 'Complete review' })
  await expect(finish.getByLabel('Review notes')).toHaveValue('Push the wave before roaming.')
  await finish
    .getByLabel('Review notes')
    .fill('Push the wave before roaming. Track the jungler before committing.')
  await page.screenshot({ path: testInfo.outputPath('complete-review-desktop.png') })
  await finish.getByRole('button', { name: 'Complete review', exact: true }).click()
  await expect(finish).toHaveCount(0)
  await expect(notes.getByRole('region', { name: 'Completed reviews' })).toContainText(
    'Track the jungler',
  )
  await guest.reload()
  await guest.getByRole('button', { name: 'Add notes', exact: true }).click()
  await expect(guestNotes.getByRole('region', { name: 'Completed reviews' })).toContainText(
    'Track the jungler',
  )
  await guestNotes.getByLabel('Your name').fill('Coach')
  await guestNotes.getByLabel('Running notes').fill('Private coach observations.')
  await expect(guestNotes.getByText('Private draft saved', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Add notes', exact: true }).click()
  await expect(page.getByText('Private coach observations.', { exact: true })).toHaveCount(0)
  await guest.getByRole('button', { name: 'Complete review', exact: true }).first().click()
  const guestFinish = guest.getByRole('dialog', { name: 'Complete review' })
  await guestFinish.getByLabel('Review notes').fill('Focus on wave control before river fights.')
  await guestFinish.getByRole('button', { name: 'Complete review', exact: true }).click()
  await expect(guestFinish).toHaveCount(0)
  await guestNotes.getByLabel('Running notes').fill('A private revision, not ready to share.')
  await expect(guestNotes.getByText('Private draft saved', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Add notes', exact: true }).click()
  await expect(notes.getByRole('region', { name: 'Completed reviews' })).toContainText(
    'Focus on wave control',
  )
  await expect(
    page.getByText('A private revision, not ready to share.', { exact: true }),
  ).toHaveCount(0)
  await guest.screenshot({ path: testInfo.outputPath('running-notes-mobile.png'), fullPage: true })
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await notes.getByRole('button', { name: 'Timeline', exact: true }).click()
  await seekVideo(page, 'Ranked mid review', 30)
  await page.getByRole('button', { name: 'Enter cinema mode' }).click()
  await expect(page.getByRole('button', { name: 'Add notes', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add review notes' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Add review notes' }).click()
  await expect(notes).toBeVisible()
  await expect(page.locator('.topbar')).toBeHidden()
  await notes.getByRole('button', { name: 'Insert time', exact: true }).click()
  await expect(notes.getByLabel('Running notes')).toHaveValue(/0:30 — /)
  await expect(notes.getByText('Private draft saved', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('running-notes-cinema.png') })
  await notes.getByRole('button', { name: 'Exit cinema mode' }).click()
  await expect(page.locator('.video-bar')).toBeVisible()
  await guestContext.close()
})

test('Teamfights filter independently hides teamfights while keeping solo kills', async ({
  page,
}) => {
  const state: State = {
    review: reviewPayload(),
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 0 },
    comments: [],
    calls: [],
  }
  await mock(page.context(), state, true)
  await signIn(page.context())
  await page.goto(`/#/video/${recordingId}`)
  const panel = page.getByRole('region', { name: 'Review timeline' })
  await expect(panel.getByRole('button', { name: 'Teamfight', exact: true })).toBeVisible()
  await page.getByLabel('Filter timeline', { exact: true }).click()
  await panel.getByRole('checkbox', { name: /Teamfights/ }).uncheck()
  await expect(panel.getByRole('checkbox', { name: /Kills/ })).toBeChecked()
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('league-cloud-coach-hidden-kinds') || '[]'),
    ),
  ).not.toContain('death')
  await expect(panel.getByRole('button', { name: 'Teamfight', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Killed Ahri', exact: true })).toBeVisible()
  await page.reload()
  await expect(panel.getByRole('button', { name: 'Teamfight', exact: true })).toHaveCount(0)
  await page.getByLabel('Filter timeline', { exact: true }).click()
  await panel.getByRole('checkbox', { name: /Teamfights/ }).check()
  await expect(panel.getByRole('button', { name: 'Teamfight', exact: true })).toBeVisible()
})

test('our control bar replaces the browser controls: one action per key, click and drag', async ({
  page,
}, testInfo) => {
  const samples = 1800 * 8000
  const long = Buffer.alloc(44 + samples, 128)
  wav.copy(long, 0, 0, 44)
  long.writeUInt32LE(36 + samples, 4)
  long.writeUInt32LE(samples, 40)
  const state: State = {
    review: reviewPayload(),
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 0 },
    comments: [],
    captures: [],
    calls: [],
  }
  await mock(page.context(), state, true)
  await page.context().route('https://customer-test.cloudflarestream.com/review.wav', (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), long.length - 1) : long.length - 1
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'audio/wav',
      body: long.subarray(start, end + 1),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${long.length}` } : {}),
      },
    })
  })
  await signIn(page.context())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/#/video/${recordingId}`)
  const video = page.getByLabel('Ranked mid review', { exact: true })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBe(1800)
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(false)
  const bar = page.getByRole('group', { name: 'Player controls' })
  const scrubber = bar.getByRole('slider', { name: 'Seek' })
  await expect(scrubber).toHaveAttribute('aria-valuemax', '1800')
  await expect(bar.locator('.bar-marker').first()).toBeAttached()
  await video.evaluate((v: HTMLVideoElement) => {
    const w = window as unknown as { toggles: number }
    w.toggles = 0
    v.addEventListener('play', () => w.toggles++)
    v.addEventListener('pause', () => w.toggles++)
    v.currentTime = 600
  })
  const toggles = () => page.evaluate(() => (window as unknown as { toggles: number }).toggles)
  const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime)
  const press = async (key: string) => {
    const before = { time: await time(), toggles: await toggles() }
    await page.keyboard.press(key)
    await page.waitForTimeout(250)
    return { moved: (await time()) - before.time, toggled: (await toggles()) - before.toggles }
  }
  // Clicking the picture plays/pauses once.
  const box = (await video.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(toggles).toBe(1)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(toggles).toBe(2)
  // Keys act once whatever was clicked last.
  for (const target of [
    bar.getByRole('button', { name: 'Forward 10 seconds' }),
    bar.getByRole('button', { name: /^(Play|Pause)$/ }),
    video,
  ]) {
    await target.click()
    if (!(await video.evaluate((v: HTMLVideoElement) => v.paused))) await press('Space')
    await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 600))
    expect((await press('ArrowRight')).moved).toBeCloseTo(1, 1)
    expect((await press('Shift+ArrowLeft')).moved).toBeCloseTo(-10, 1)
    expect((await press('Space')).toggled).toBe(1)
    expect((await press('Space')).toggled).toBe(1)
  }
  // The scrubber seeks once, on release, wherever it was dragged to.
  await video.evaluate((v: HTMLVideoElement) => {
    const w = window as unknown as { seeks: number }
    w.seeks = 0
    v.addEventListener('seeking', () => w.seeks++)
  })
  const track = (await bar.locator('.bar-track').boundingBox())!
  await page.mouse.move(track.x + track.width * 0.2, track.y + track.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2, { steps: 10 })
  await page.mouse.move(track.x + track.width * 0.75, track.y + track.height / 2, { steps: 10 })
  await expect(bar.locator('.bar-peek')).toBeVisible()
  await page.mouse.up()
  await expect.poll(time).toBeGreaterThan(1340)
  expect(await time()).toBeLessThan(1360)
  const seeks = () => page.evaluate(() => (window as unknown as { seeks: number }).seeks)
  await expect.poll(seeks).toBe(1)
  await page.waitForTimeout(300)
  expect(await seeks()).toBe(1)
  // Arrow keys on the focused scrubber step like everywhere else.
  expect((await press('ArrowRight')).moved).toBeCloseTo(1, 1)
  await bar.getByRole('button', { name: 'Back 30 seconds' }).click()
  await expect.poll(time).toBeLessThan(1330)
  await bar.getByLabel('Playback speed').selectOption('1.5')
  expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5)
  await bar.getByRole('button', { name: 'Mute' }).click()
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true)
  // Markers carry icons; the clock has no "game"/"video" suffix.
  await expect(bar.locator('.bar-marker .bar-icon svg').first()).toBeVisible()
  await expect(bar.locator('.bar-time')).not.toContainText(/game|video/)
  await page.screenshot({ path: testInfo.outputPath('player-bar.png') })
  // Zoom: buttons, wheel around the pointer, and the window follows the playhead.
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 900))
  await expect(bar.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  await bar.getByRole('button', { name: 'Zoom in' }).click()
  await bar.getByRole('button', { name: 'Zoom in' }).click()
  await expect(bar.getByRole('button', { name: 'Reset zoom' })).toHaveText('4×')
  await expect(bar.locator('.bar-overview')).toBeVisible()
  const markerCount = async () => bar.locator('.bar-marker').count()
  const span = async () => {
    const [from, to] = await bar.locator('.bar-overview > span').allTextContents()
    const seconds = (label: string) =>
      label.split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return seconds(to) - seconds(from)
  }
  expect(await span()).toBeGreaterThan(440)
  expect(await span()).toBeLessThan(460)
  const zoomTrack = (await bar.locator('.bar-track').boundingBox())!
  await page.mouse.move(zoomTrack.x + zoomTrack.width / 2, zoomTrack.y + zoomTrack.height / 2)
  await page.mouse.wheel(0, -400)
  await expect.poll(span).toBeLessThan(300)
  await bar.screenshot({ path: testInfo.outputPath('player-bar-zoomed.png') })
  // Clicking the zoomed track still seeks to the time under the pointer.
  const peeked = await bar.locator('.bar-peek').textContent()
  await page.mouse.click(zoomTrack.x + zoomTrack.width / 2, zoomTrack.y + zoomTrack.height / 2)
  const target = peeked!.match(/\d+:\d\d(:\d\d)?/)![0]
  await expect(bar.locator('.bar-time')).toContainText(target)
  // A seek outside the window brings the window to the playhead.
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 1700))
  await expect
    .poll(async () => (await bar.locator('.bar-overview > span').first().textContent()) ?? '')
    .toMatch(/^2[3-9]:/)
  await expect(bar.locator('.bar-thumb')).toBeVisible()
  await bar.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(bar.locator('.bar-overview')).toBeHidden()
  expect(await markerCount()).toBeGreaterThan(0)
})

test('lease renewal keeps hls.js playing from its buffer on freshly signed segments', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const dir = new URL('./fixtures/hls/', import.meta.url)
  const index = readFileSync(new URL('index.m3u8', dir), 'utf8')
  const host = 'https://customer-test.cloudflarestream.com'
  // Cloudflare-shaped: the lease token is in the manifest path, and every
  // rendition/segment URL carries its own signature that dies with the lease.
  let generation = 0
  let valid = new Set<number>()
  const rejected: string[] = []
  const state: State = {
    review: null,
    anchor: null,
    comments: [],
    captures: [],
    calls: [],
    mse: true,
    lease: () => {
      generation += 1
      valid.add(generation)
      // Renews about two seconds after issue (the player renews 60s early).
      return {
        url: `${host}/token${generation}/manifest/video.m3u8`,
        expiresAt: new Date(Date.now() + 62_000).toISOString(),
      }
    },
  }
  await mock(page.context(), state, true)
  const cors = { 'Access-Control-Allow-Origin': '*' }
  await page.context().route(`${host}/**`, async (route) => {
    const url = new URL(route.request().url())
    const manifest = url.pathname.match(/^\/token(\d+)\/manifest\/video\.m3u8$/)
    if (manifest)
      return route.fulfill({
        headers: cors,
        contentType: 'application/vnd.apple.mpegurl',
        body: `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=160x90,CODECS="avc1.64000c"\nstream_g${manifest[1]}.m3u8\n`,
      })
    const variant = url.pathname.match(/^\/token(\d+)\/manifest\/stream_g(\d+)\.m3u8$/)
    if (variant) {
      const sig = Number(variant[2])
      // The renewed signature is live; the ones before it now expire.
      valid = new Set([...valid].filter((g) => g >= sig))
      return route.fulfill({
        headers: cors,
        contentType: 'application/vnd.apple.mpegurl',
        body: index.replace(/^(?!#)(.+)$|URI="([^"]+)"/gm, (_, line?: string, uri?: string) =>
          line ? `../../vid/${line}?s=${sig}` : `URI="../../vid/${uri}?s=${sig}"`,
        ),
      })
    }
    const file = url.pathname.match(/^\/vid\/([\w.]+)$/)
    if (!file || !valid.has(Number(url.searchParams.get('s')))) {
      rejected.push(url.pathname + url.search)
      return route.fulfill({ status: 403, headers: cors })
    }
    // Slow segments, so loading spans several renewals.
    await new Promise((resolve) => setTimeout(resolve, 250))
    return route.fulfill({
      headers: cors,
      contentType: 'video/mp4',
      body: readFileSync(new URL(file[1], dir)),
    })
  })
  await signIn(page.context())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/#/video/${recordingId}`)
  const video = page.getByLabel('Ranked mid review', { exact: true })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  await video.evaluate((v: HTMLVideoElement) => {
    const w = window as unknown as { emptied: number }
    w.emptied = 0
    v.addEventListener('emptied', () => w.emptied++)
  })
  // The whole 40s video buffers while leases renew underneath it.
  await expect
    .poll(
      () => video.evaluate((v: HTMLVideoElement) => (v.buffered.length ? v.buffered.end(0) : 0)),
      {
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(39)
  expect(generation).toBeGreaterThanOrEqual(3)
  expect(await video.evaluate((v: HTMLVideoElement) => v.buffered.start(0))).toBeLessThan(0.5)
  // The media was never torn down, and no request used an expired signature.
  expect(await page.evaluate(() => (window as unknown as { emptied: number }).emptied)).toBe(0)
  expect(rejected).toEqual([])
})
