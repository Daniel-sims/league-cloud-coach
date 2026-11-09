import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStreamHandler } from './handler'

const token = 'a'.repeat(64)
const session = 'b'.repeat(64)
const id = 'd'.repeat(32)
const rpc = vi.fn()
const ownerRpc = vi.fn()
const getUser = vi.fn()
const provider = vi.fn()
const env: Record<string, string> = {
  CLOUDFLARE_ACCOUNT_ID: 'e'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'private-cf-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'private-service-key',
  SUPABASE_ANON_KEY: 'anon-key',
}
const handler = createStreamHandler({
  env: (key) => env[key],
  fetch: provider,
  createClient: (_url, key) =>
    (key === 'private-service-key'
      ? { rpc, auth: { getUser } }
      : { rpc: ownerRpc }) as unknown as SupabaseClient,
})
const request = (body: unknown, jwt?: string) =>
  handler(
    new Request('https://example.test/stream', {
      method: 'POST',
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      body: JSON.stringify(body),
    }),
  )
beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({
    data: [
      {
        stream_video_id: id,
        session_expires_at: new Date(Date.now() + 7200000).toISOString(),
      },
    ],
    error: null,
  })
  getUser.mockResolvedValue({ data: { user: { id: 'owner-id' } }, error: null })
  ownerRpc.mockResolvedValue({ data: true, error: null })
  provider.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify({
          success: true,
          result: url.endsWith('/token')
            ? { token: 'signed-playback' }
            : {
                uid: id,
                requireSignedURLs: true,
                readyToStream: true,
                playback: {
                  hls: `https://customer-example.cloudflarestream.com/${id}/manifest/video.m3u8`,
                },
              },
        }),
      ),
  )
})
it('signs only a database-authorized share, for five minutes without downloads', async () => {
  const response = await request({ action: 'start', token, session })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(rpc).toHaveBeenCalledWith('authorize_stream_share', {
    p_token: token,
    p_session: session,
    p_start: true,
  })
  const body = await response.json()
  expect(body.url).toBe(
    'https://customer-example.cloudflarestream.com/signed-playback/manifest/video.m3u8',
  )
  const claims = JSON.parse(provider.mock.calls[1][1].body)
  expect(claims.downloadable).toBe(false)
  expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300)
  expect(JSON.stringify(body)).not.toContain('private-')
})
it('caps playback expiry at the existing session deadline', async () => {
  const end = Math.floor(Date.now() / 1000) + 40
  rpc.mockResolvedValue({
    data: [
      {
        stream_video_id: id,
        session_expires_at: new Date(end * 1000).toISOString(),
      },
    ],
    error: null,
  })
  expect((await request({ action: 'renew', token, session })).status).toBe(200)
  expect(JSON.parse(provider.mock.calls[1][1].body).exp).toBe(end)
  expect(rpc.mock.calls[0][1].p_start).toBe(false)
})
it('does not call Cloudflare for invalid, revoked, expired or unclaimed capabilities', async () => {
  expect((await request({ action: 'start', token: 'bad', session })).status).toBe(400)
  expect(rpc).not.toHaveBeenCalled()
  rpc.mockResolvedValue({ data: [], error: null })
  expect((await request({ action: 'renew', token, session })).status).toBe(410)
  expect(provider).not.toHaveBeenCalled()
})
it('requires a verified owner identity before adding a video', async () => {
  expect((await request({ action: 'add', videoId: id, title: 'Game' })).status).toBe(401)
  getUser.mockResolvedValue({
    data: { user: null },
    error: new Error('bad jwt'),
  })
  expect((await request({ action: 'add', videoId: id, title: 'Game' }, 'forged')).status).toBe(401)
  expect(provider).not.toHaveBeenCalled()
})
it('does not let a signed-in non-owner access Stream', async () => {
  ownerRpc.mockResolvedValue({ data: false, error: null })
  expect((await request({ action: 'owner', recordingId: 'other' }, 'valid-jwt')).status).toBe(403)
  expect(provider).not.toHaveBeenCalled()
})
it('refuses public media instead of minting tokens for it', async () => {
  provider.mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        result: { uid: id, readyToStream: true, requireSignedURLs: false },
      }),
    ),
  )
  expect((await request({ action: 'add', videoId: id, title: 'Game' }, 'valid-jwt')).status).toBe(
    400,
  )
  expect(rpc).not.toHaveBeenCalled()
})
it('stores verified owner identity, never a caller-supplied owner', async () => {
  rpc.mockResolvedValue({ data: 'recording', error: null })
  expect(
    (await request({ action: 'add', videoId: id, title: 'Game', ownerId: 'attacker' }, 'valid-jwt'))
      .status,
  ).toBe(200)
  expect(rpc).toHaveBeenCalledWith('add_stream_recording', {
    p_owner: 'owner-id',
    p_title: 'Game',
    p_video_id: id,
    p_recorded_on: null,
  })
})
it('returns safe provider failures without leaking API responses', async () => {
  provider.mockResolvedValue(new Response('private-cf-key', { status: 403 }))
  const response = await request({ action: 'start', token, session })
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('private-cf-key')
})
