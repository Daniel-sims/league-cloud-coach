import { expect, test, type BrowserContext } from '@playwright/test'

// Browser/API contract tests. Real SQL authorization is tested independently
// against PostgreSQL in supabase/tests/security.sql; this is not a live login.
const ownerId = '11111111-1111-4111-8111-111111111111'
const recordingId = '44444444-4444-4444-8444-444444444444'
const token = 'a'.repeat(64)
const user = {
  id: ownerId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.test',
  app_metadata: { provider: 'google' },
  user_metadata: { full_name: 'Library Owner' },
  created_at: '2026-11-09T00:00:00Z',
}
type Fixture = {
  rows: {
    id: string
    title: string
    youtube_video_id: string | null
    provider?: 'youtube' | 'stream'
    stream_video_id?: string
    recorded_on: string | null
    created_at: string
    has_share: boolean
  }[]
  member: boolean
  shared: boolean
  uploadState?: 'uploading' | 'processing' | 'ready'
  thumbnailRequests?: number
}

async function mockBackend(context: BrowserContext, state: Fixture) {
  await context.route('https://cloud-coach-test.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    const args = route.request().postDataJSON() || {}
    let result: unknown = null
    if (name === 'stream' && args.action === 'upload-sync') result = { imported: 0, pending: [] }
    if (name === 'stream' && args.action === 'upload-create') {
      state.uploadState = 'uploading'
      result = {
        videoId: 'd'.repeat(32),
        uploadURL: 'https://upload.cloudflarestream.com/tus/test-video',
      }
    }
    if (name === 'stream' && args.action === 'upload-status') {
      if (state.uploadState === 'ready' && !state.rows.length)
        state.rows.push({
          id: recordingId,
          title: 'Uploaded review',
          youtube_video_id: null,
          provider: 'stream',
          stream_video_id: 'd'.repeat(32),
          recorded_on: null,
          created_at: new Date().toISOString(),
          has_share: false,
        })
      result = {
        state: state.uploadState || 'uploading',
        ...(state.uploadState === 'ready' ? { recordingId } : {}),
      }
    }
    if (name === 'stream' && args.action === 'add') {
      state.rows.unshift({
        id: recordingId,
        title: args.title,
        youtube_video_id: null,
        provider: 'stream',
        stream_video_id: args.videoId,
        recorded_on: args.recordedOn,
        created_at: new Date().toISOString(),
        has_share: false,
      })
      result = { ok: true }
    }
    if (name === 'stream' && args.action === 'thumbnail') {
      state.thumbnailRequests = (state.thumbnailRequests || 0) + 1
      result = {
        url: 'https://customer-test.cloudflarestream.com/signed-thumbnail/thumbnails/thumbnail.jpg?time=0s&height=180&fit=clip',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      }
    }
    if (name === 'stream' && args.action === 'owner')
      result = {
        url: 'https://customer-test.cloudflarestream.com/keyboard-review.wav',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        sessionExpiresAt: null,
      }
    if (name === 'stream' && (args.action === 'start' || args.action === 'renew')) {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'This session is unavailable. Ask the owner for a new link.',
        }),
      })
      return
    }
    if (name === 'user') result = user
    if (name === 'is_library_owner') result = state.member
    if (name === 'list_recordings')
      result = state.rows.map((r) => ({ ...r, has_share: state.shared }))
    if (name === 'add_recording') {
      state.rows.unshift({
        id: recordingId,
        title: args.p_title,
        youtube_video_id: args.p_video_id,
        recorded_on: args.p_recorded_on,
        created_at: '2026-11-09T12:00:00Z',
        has_share: false,
      })
      result = recordingId
    }
    if (name === 'create_recording_share') {
      state.shared = true
      result = token
    }
    if (name === 'revoke_recording_share') state.shared = false
    if (name === 'list_recording_guests')
      result = state.shared
        ? [{ id: 'g1', name: 'Coach', active: true, link_created_at: null, started_at: null }]
        : []
    if (name === 'create_guest_link') {
      state.shared = true
      result = token
    }
    if (name === 'revoke_guest_link') state.shared = false
    if (name === 'resolve_recording_share')
      result =
        state.shared && args.p_token === token && state.rows[0]
          ? [
              {
                title: state.rows[0].title,
                youtube_video_id: state.rows[0].youtube_video_id,
                recorded_on: state.rows[0].recorded_on,
                provider: state.rows[0].provider,
                stream_video_id: state.rows[0].stream_video_id,
                guest_name: 'Coach',
                guest_key: 'a'.repeat(64),
              },
            ]
          : []
    if (name === 'rename_recording') state.rows[0].title = args.p_title
    if (name === 'remove_recording') {
      state.rows = []
      state.shared = false
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}

async function setOwnerSession(context: BrowserContext) {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: ownerId, exp: expires, role: 'authenticated' })).toString('base64url')}.test-signature`
  await context.addInitScript(
    ({ session }) =>
      localStorage.setItem('sb-cloud-coach-test-auth-token', JSON.stringify(session)),
    {
      session: {
        access_token: accessToken,
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expires,
        user,
      },
    },
  )
}

test('owner adds a recording, shares to a signed-out visitor, and revokes its app link', async ({
  page,
  browser,
}) => {
  const state: Fixture = { rows: [], member: true, shared: false }
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  await page.goto('/#/library')
  await page.getByRole('button', { name: 'Add existing video' }).click()
  await page.getByLabel('YouTube link', { exact: true }).fill('https://youtu.be/aqz-KE-bpKQ')
  await page.getByLabel('Title', { exact: true }).fill('Review with my coach')
  await page.getByRole('dialog').getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Review with my coach', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByLabel('Who is this link for?').fill('Coach')
  await page.getByRole('button', { name: 'Create link', exact: true }).click()
  await expect(page.getByLabel('Watch link for Coach', { exact: true })).toHaveValue(
    new RegExp(`/#/watch/${token}$`),
  )
  const link = await page.getByLabel('Watch link for Coach', { exact: true }).inputValue()
  const guestContext = await browser.newContext()
  await mockBackend(guestContext, state)
  const guest = await guestContext.newPage()
  await guest.goto(link)
  await expect(
    guest.getByRole('heading', { name: 'Review with my coach', exact: true }),
  ).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  await expect(guest.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  )
  await expect(guest.getByText('Reviewing as Coach')).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await guest.reload()
  await expect(guest.getByRole('heading', { name: 'This game isn’t shared here.' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('In your library', { exact: true })).toHaveCount(0)
  await expect(page.getByText('GAME RECORDING', { exact: true })).toHaveCount(0)
  await guestContext.close()
})

test('signed-in Google account without owner membership gets no library management UI', async ({
  page,
}) => {
  const state: Fixture = { rows: [], member: false, shared: false }
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  await page.goto('/#/library')
  await expect(page.getByRole('heading', { name: 'You’re signed in.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add video', exact: true })).toHaveCount(0)
})

test('Stream owner adds a video ID and guest must explicitly start private playback', async ({
  page,
  browser,
}) => {
  const state: Fixture = { rows: [], member: true, shared: false }
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  await page.goto('/#/library')
  await page.getByRole('button', { name: 'Add existing video' }).click()
  await page.getByLabel('Video hosting').selectOption('stream')
  await page.getByLabel('Stream video ID', { exact: true }).fill('d'.repeat(32))
  await page.getByLabel('Title', { exact: true }).fill('Private Stream review')
  await page.getByRole('dialog').getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Private Stream review', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByText(/One browser session per link/)).toBeVisible()
  await page.getByLabel('Who is this link for?').fill('Coach')
  await page.getByRole('button', { name: 'Create link', exact: true }).click()
  const link = await page.getByLabel('Watch link for Coach', { exact: true }).inputValue()
  const context = await browser.newContext()
  await mockBackend(context, state)
  const guest = await context.newPage()
  let claims = 0
  guest.on('request', (request) => {
    if (request.url().endsWith('/functions/v1/stream')) claims++
  })
  await guest.goto(link)
  await expect(guest.getByRole('button', { name: 'Start session', exact: true })).toBeVisible()
  expect(claims).toBe(0)
  await expect(guest.getByRole('link', { name: 'Open on YouTube' })).toHaveCount(0)
  await guest.getByRole('button', { name: 'Start session', exact: true }).click()
  await expect(guest.getByRole('alert')).toContainText('Ask the owner for a new link.')
  expect(claims).toBe(1)
  await guest.reload()
  await expect(guest.getByRole('button', { name: 'Start session', exact: true })).toBeVisible()
  expect(claims).toBe(1)
  await context.close()
})

test('owner uploads directly to Cloudflare and the library waits for processing', async ({
  page,
}) => {
  const state: Fixture = { rows: [], member: true, shared: false }
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  let patches = 0
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'HEAD, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Upload-Offset, Upload-Length, Tus-Resumable',
    'Tus-Resumable': '1.0.0',
    'Upload-Length': '10',
  }
  await page.route('https://upload.cloudflarestream.com/tus/test-video', async (route) => {
    const request = route.request()
    expect(request.headers().authorization).toBeUndefined()
    expect(request.headers().apikey).toBeUndefined()
    if (request.method() === 'PATCH') {
      patches++
      state.uploadState = 'processing'
    }
    await route.fulfill({
      status: 204,
      headers: { ...headers, 'Upload-Offset': patches ? '10' : '0' },
    })
  })
  await page.goto('/#/library')
  await page.getByRole('button', { name: 'Upload your first video', exact: true }).click()
  await page.getByLabel('Video file', { exact: true }).setInputFiles({
    name: 'game.mov',
    mimeType: 'video/quicktime',
    buffer: Buffer.from('video-data'),
  })
  await page.getByLabel('Title', { exact: true }).fill('Uploaded review')
  await page.getByRole('button', { name: 'Upload to Cloudflare', exact: true }).click()
  await expect(page.getByText('File uploaded. Preparing your recording…')).toBeVisible()
  expect(patches).toBe(1)
  expect(state.rows).toHaveLength(0)
  state.uploadState = 'ready'
  // Processing can finish on the automatic poll before a manual refresh click.
  // Wait for the resulting library entry instead of racing a disappearing dialog.
  await expect(page.getByRole('link', { name: 'Uploaded review', exact: true })).toBeVisible({
    timeout: 10000,
  })
  await expect(page.getByRole('dialog', { name: 'Upload successful' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Watch video', exact: true })).toHaveAttribute(
    'href',
    `#/video/${recordingId}`,
  )
  await page.getByRole('button', { name: 'Back to library' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('library recovers completed uploads after the upload dialog was closed', async ({ page }) => {
  await page.clock.install()
  const state: Fixture = { rows: [], member: true, shared: false }
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  let ready = false
  await page.route('https://cloud-coach-test.supabase.co/functions/v1/stream', async (route) => {
    const body = route.request().postDataJSON()
    if (body.action !== 'upload-sync') {
      await route.fallback()
      return
    }
    if (ready && !state.rows.length)
      state.rows.push({
        id: recordingId,
        title: 'Recovered upload',
        youtube_video_id: null,
        provider: 'stream',
        stream_video_id: 'd'.repeat(32),
        recorded_on: null,
        created_at: new Date().toISOString(),
        has_share: false,
      })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        imported: ready ? 1 : 0,
        pending: ready
          ? []
          : [{ videoId: 'd'.repeat(32), title: 'Recovered upload', state: 'processing' }],
      }),
    })
  })
  await page.goto('/#/library')
  await expect(
    page.getByText('Processing your video. It will appear here automatically.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('tab', { name: /^Shared/ }).click()
  await page.getByRole('searchbox').fill('unrelated search')
  ready = true
  await page.clock.fastForward(15000)
  await expect(page.getByRole('link', { name: 'Recovered upload', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('uploaded video uses precise keyboard seek steps without the native default jump', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'MediaSource', { value: undefined, configurable: true })
    Object.defineProperty(window, 'ManagedMediaSource', { value: undefined, configurable: true })
    const original = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function (type) {
      return type === 'application/vnd.apple.mpegurl' ? 'maybe' : original.call(this, type)
    }
  })
  // A disposable silent WAV gives the real HTML video element a seekable timeline.
  const samples = 120 * 8000,
    wav = Buffer.alloc(44 + samples, 128)
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
  await page.route('https://customer-test.cloudflarestream.com/keyboard-review.wav', (route) => {
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
  await mockBackend(page.context(), {
    rows: [
      {
        id: recordingId,
        title: 'Keyboard review',
        provider: 'stream',
        stream_video_id: 'd'.repeat(32),
        youtube_video_id: null,
        recorded_on: null,
        created_at: new Date().toISOString(),
        has_share: false,
      },
    ],
    member: true,
    shared: false,
  })
  await setOwnerSession(page.context())
  await page.goto(`/#/video/${recordingId}`)
  const video = page.getByLabel('Keyboard review', { exact: true })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBe(120)
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) =>
        element.seekable.length ? element.seekable.end(0) : 0,
      ),
    )
    .toBe(120)
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 50
    element.playbackRate = 2
  })
  await video.focus()
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBe(50)
  for (const [key, position] of [
    ['ArrowRight', 51],
    ['ArrowLeft', 50],
    ['Shift+ArrowRight', 60],
    ['Shift+ArrowLeft', 50],
    ['Control+ArrowRight', 80],
    ['Control+ArrowLeft', 50],
  ] as const) {
    await page.keyboard.press(key)
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBe(position)
  }
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
})

test('library drops redundant labels and shows a signed first-frame Stream thumbnail', async ({
  page,
}, testInfo) => {
  const state: Fixture = {
    member: true,
    shared: false,
    rows: [
      {
        id: recordingId,
        title: 'Mid lane review',
        youtube_video_id: null,
        provider: 'stream',
        stream_video_id: 'd'.repeat(32),
        recorded_on: '2026-11-10',
        created_at: '2026-11-10T12:00:00Z',
        has_share: false,
      },
    ],
  }
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  const images: string[] = []
  await page.route(
    'https://customer-test.cloudflarestream.com/**/thumbnails/thumbnail.jpg?**',
    (route) => {
      images.push(route.request().url())
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#253b31"/><text x="520" y="40" fill="white" font-size="24">00:00</text></svg>',
      })
    },
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/library')
  const row = page.locator('.recording-row')
  const image = row.locator('.recording-thumbnail img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640)
  expect(new URL(images[0]).searchParams.get('time')).toBe('0s')
  expect(images[0]).toContain('/signed-thumbnail/')
  await expect(row.getByText('In your library', { exact: true })).toHaveCount(0)
  await expect(row.getByText('GAME RECORDING', { exact: true })).toHaveCount(0)
  await page.screenshot({
    path: testInfo.outputPath('library-first-frame-desktop.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(image).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('library-first-frame-mobile.png'),
    fullPage: true,
  })
})

test('library restores metadata and image bytes before a slow refresh and clears them on sign-out', async ({
  page,
}) => {
  const state: Fixture = {
    member: true,
    shared: false,
    rows: [
      {
        id: recordingId,
        title: 'Cached mid review',
        youtube_video_id: null,
        provider: 'stream',
        stream_video_id: 'd'.repeat(32),
        recorded_on: '2026-11-10',
        created_at: '2026-11-10T12:00:00Z',
        has_share: false,
      },
    ],
  }
  let playbackRequests = 0
  page.on('request', (request) => {
    if (
      request.url().endsWith('/functions/v1/stream') &&
      request.method() === 'POST' &&
      request.postDataJSON()?.action === 'owner'
    )
      playbackRequests++
  })
  await mockBackend(page.context(), state)
  await setOwnerSession(page.context())
  await page.route(
    'https://customer-test.cloudflarestream.com/**/thumbnails/thumbnail.jpg?**',
    (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6kEIAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
  )
  await page.goto('/#/library')
  const title = () => page.getByRole('link', { name: state.rows[0].title, exact: true })
  await expect(title()).toBeVisible()
  await expect(page.locator('.recording-thumbnail img')).toHaveAttribute('src', /^blob:/)
  await expect
    .poll(() =>
      page
        .locator('.recording-thumbnail img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1)
  expect(playbackRequests).toBe(0)
  expect(state.thumbnailRequests).toBe(1)
  const stored = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('league-cloud-coach.library.v1:'))
      .map((k) => localStorage.getItem(k))
      .join(''),
  )
  expect(stored).toContain('Cached mid review')
  expect(stored).not.toContain('signed-thumbnail')
  // Hold only the list RPC. Auth/membership checks still complete normally.
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = true
  await page.route(
    'https://cloud-coach-test.supabase.co/rest/v1/rpc/list_recordings',
    async (route) => {
      if (held) await gate
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.rows) })
    },
  )
  await page.reload()
  await expect(title()).toBeVisible()
  await expect(page.getByText('Loading your games…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.recording-thumbnail img')).toHaveAttribute('src', /^blob:/)
  expect(state.thumbnailRequests).toBe(1) // Fresh page uses IndexedDB, not another signed lease.
  state.rows[0].title = 'Updated title from server'
  held = false
  release()
  await expect(title()).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Continue with Google', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) => k.startsWith('league-cloud-coach.library.v1:'))
          .length,
    ),
  ).toBe(0)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const databases = await indexedDB.databases()
        const cache = databases.find((d) => d.name?.startsWith('league-cloud-coach.library.v1:'))
        if (!cache?.name) return 0
        return new Promise<number>((resolve) => {
          const request = indexedDB.open(cache.name!)
          request.onsuccess = () => {
            const db = request.result
            const count = db.transaction('images').objectStore('images').count()
            count.onsuccess = () => {
              db.close()
              resolve(count.result)
            }
          }
        })
      }),
    )
    .toBe(0)
})
