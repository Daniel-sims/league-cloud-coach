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
    youtube_video_id: string
    recorded_on: string | null
    created_at: string
    has_share: boolean
  }[]
  member: boolean
  shared: boolean
}

async function mockBackend(context: BrowserContext, state: Fixture) {
  await context.route('https://cloud-coach-test.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    const args = route.request().postDataJSON() || {}
    let result: unknown = null
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
    if (name === 'resolve_recording_share')
      result =
        state.shared && args.p_token === token && state.rows[0]
          ? [
              {
                title: state.rows[0].title,
                youtube_video_id: state.rows[0].youtube_video_id,
                recorded_on: state.rows[0].recorded_on,
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
  await page.getByRole('button', { name: 'Add your first video' }).click()
  await page.getByLabel('YouTube link', { exact: true }).fill('https://youtu.be/aqz-KE-bpKQ')
  await page.getByLabel('Title', { exact: true }).fill('Review with my coach')
  await page.getByRole('dialog').getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Review with my coach', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.getByRole('button', { name: 'Create share link', exact: true }).click()
  await expect(page.getByLabel('Your watch link', { exact: true })).toHaveValue(
    new RegExp(`/#/watch/${token}$`),
  )
  const link = await page.getByLabel('Your watch link', { exact: true }).inputValue()
  const guestContext = await browser.newContext()
  await mockBackend(guestContext, state)
  const guest = await guestContext.newPage()
  await guest.goto(link)
  await expect(
    guest.getByRole('heading', { name: 'Review with my coach', exact: true }),
  ).toBeVisible()
  await expect(guest.getByText('No account needed', { exact: true })).toBeVisible()
  await expect(guest.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  )
  await page.getByRole('button', { name: 'Stop sharing this app link' }).click()
  await guest.reload()
  await expect(guest.getByRole('heading', { name: 'This game isn’t shared here.' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByText('In your library', { exact: true })).toBeVisible()
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
