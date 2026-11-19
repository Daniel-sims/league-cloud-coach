import { beforeEach, describe, expect, it, vi } from 'vitest'
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
describe('delete', () => {
  const recording = { id: 'rec-1', provider: 'stream', stream_video_id: id }
  function setup(options: { shared?: boolean; creator?: string; lookup?: number; remove?: number }) {
    ownerRpc.mockImplementation(async (name: string) =>
      name === 'list_recordings'
        ? { data: [recording], error: null }
        : name === 'remove_recording'
          ? { data: null, error: null }
          : { data: true, error: null },
    )
    rpc.mockResolvedValue({ data: options.shared ?? false, error: null })
    provider.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: options.remove ?? 200 })
        : new Response(
            JSON.stringify({ success: true, result: { uid: id, creator: options.creator } }),
            { status: options.lookup ?? 200 },
          ),
    )
  }
  const del = () => request({ action: 'delete', recordingId: 'rec-1' }, 'valid-jwt')
  const deletes = () => provider.mock.calls.filter(([, init]) => init?.method === 'DELETE')

  it('deletes the owner’s Cloudflare video, then the library entry', async () => {
    setup({ creator: 'owner-id' })
    const response = await del()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, kept: false })
    expect(deletes()[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${'e'.repeat(32)}/stream/${id}`,
    )
    expect(rpc).toHaveBeenCalledWith('stream_video_shared', { p_owner: 'owner-id', p_video: id })
    expect(ownerRpc).toHaveBeenCalledWith('remove_recording', { p_id: 'rec-1' })
  })
  it('keeps the library entry when Cloudflare refuses, so a retry can finish', async () => {
    setup({ remove: 500 })
    expect((await del()).status).toBe(502)
    expect(ownerRpc).not.toHaveBeenCalledWith('remove_recording', expect.anything())
  })
  it('removes the entry when the video is already gone from Cloudflare', async () => {
    setup({ lookup: 404 })
    expect((await del()).status).toBe(200)
    expect(deletes()).toHaveLength(0)
    expect(ownerRpc).toHaveBeenCalledWith('remove_recording', { p_id: 'rec-1' })
  })
  it('keeps videos another owner uploaded or still uses', async () => {
    setup({ creator: 'someone-else' })
    expect(await (await del()).json()).toEqual({ ok: true, kept: true })
    setup({ shared: true })
    expect(await (await del()).json()).toEqual({ ok: true, kept: true })
    expect(deletes()).toHaveLength(0)
  })
  it('never deletes for guests or signed-in non-owners', async () => {
    expect((await request({ action: 'delete', recordingId: 'rec-1' })).status).toBe(401)
    ownerRpc.mockResolvedValue({ data: false, error: null })
    expect((await del()).status).toBe(403)
    expect(provider).not.toHaveBeenCalled()
  })
})
it('returns safe provider failures without leaking API responses', async () => {
  provider.mockResolvedValue(new Response('private-cf-key', { status: 403 }))
  const response = await request({ action: 'start', token, session })
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('private-cf-key')
})

it('never provisions uploads for guests or signed-in non-owners', async () => {
  const input = {
    action: 'upload-create',
    filename: 'game.mov',
    size: 1024,
    title: 'Game',
    maxDuration: 3600,
  }
  expect((await request(input)).status).toBe(401)
  ownerRpc.mockResolvedValue({ data: false, error: null })
  expect((await request(input, 'valid-jwt')).status).toBe(403)
  expect(provider).not.toHaveBeenCalled()
})
it('provisions a private, owner-tagged TUS destination without exposing API credentials', async () => {
  provider.mockResolvedValue(
    new Response(null, {
      status: 201,
      headers: {
        Location: 'https://upload.cloudflarestream.com/tus/one-time',
        'stream-media-id': id,
      },
    }),
  )
  const response = await request(
    {
      action: 'upload-create',
      filename: 'game.mov',
      size: 250_000_000,
      title: 'Café review',
      maxDuration: 3600,
    },
    'valid-jwt',
  )
  expect(response.status).toBe(200)
  const [url, init] = provider.mock.calls[0]
  expect(url).toContain('/stream?direct_user=true')
  expect(init.headers['Upload-Length']).toBe('250000000')
  expect(init.headers['Upload-Creator']).toBe('owner-id')
  expect(init.headers['Upload-Metadata']).toContain('requiresignedurls')
  expect(init.headers['Upload-Metadata']).toContain(`maxdurationseconds ${btoa('3600')}`)
  expect(init.headers['Upload-Metadata']).not.toContain('recordedon')
  const body = await response.text()
  expect(body).toContain('one-time')
  expect(body).not.toContain('private-cf-key')
})
it('rejects oversized and invalid uploads before reserving Cloudflare capacity', async () => {
  for (const bad of [
    { size: 0 },
    { size: 30_000_000_001 },
    { filename: 'file.html' },
    { maxDuration: 999999 },
  ]) {
    expect(
      (
        await request(
          {
            action: 'upload-create',
            filename: 'game.mov',
            size: 100,
            title: 'Game',
            maxDuration: 3600,
            ...bad,
          },
          'valid-jwt',
        )
      ).status,
    ).toBe(400)
  }
  expect(provider).not.toHaveBeenCalled()
})
it('does not import processing or failed uploads', async () => {
  for (const state of ['inprogress', 'error']) {
    provider.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            uid: id,
            creator: 'owner-id',
            meta: { appupload: 'true', name: 'Game' },
            requireSignedURLs: true,
            readyToStream: false,
            status: { state },
          },
        }),
      ),
    )
    const response = await request({ action: 'upload-status', videoId: id }, 'valid-jwt')
    expect((await response.json()).state).toBe(state === 'error' ? 'error' : 'processing')
  }
  expect(rpc).not.toHaveBeenCalled()
})
it('rejects another owner’s upload and auto-imports only verified ready media', async () => {
  const result = {
    uid: id,
    creator: 'someone-else',
    meta: { appupload: 'true', name: 'Game', recordedon: 'TRUE' },
    requireSignedURLs: true,
    readyToStream: true,
  }
  provider.mockResolvedValue(new Response(JSON.stringify({ success: true, result })))
  expect((await request({ action: 'upload-status', videoId: id }, 'valid-jwt')).status).toBe(404)
  expect(rpc).not.toHaveBeenCalled()
  provider.mockResolvedValue(
    new Response(JSON.stringify({ success: true, result: { ...result, creator: 'owner-id' } })),
  )
  rpc.mockResolvedValue({ data: 'recording-id', error: null })
  const response = await request({ action: 'upload-status', videoId: id }, 'valid-jwt')
  expect((await response.json()).state).toBe('ready')
  expect(rpc).toHaveBeenCalledWith('add_stream_recording', {
    p_owner: 'owner-id',
    p_title: 'Game',
    p_video_id: id,
    p_recorded_on: null,
  })
})

it('confirms the saved recording when background recovery wins a concurrent import', async () => {
  provider.mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        result: {
          uid: id,
          creator: 'owner-id',
          meta: { appupload: 'true', name: 'Game' },
          requireSignedURLs: true,
          readyToStream: true,
        },
      }),
    ),
  )
  rpc.mockImplementation(async (name) =>
    name === 'list_stream_imports'
      ? { data: [], error: null }
      : { data: null, error: { code: '23505' } },
  )
  ownerRpc.mockImplementation(async (name) => ({
    data: name === 'is_library_owner' ? true : [{ id: 'saved-id', stream_video_id: id }],
    error: null,
  }))
  const response = await request({ action: 'upload-status', videoId: id }, 'valid-jwt')
  expect(await response.json()).toEqual({ state: 'ready', recordingId: 'saved-id' })
})
it('requires a verified enabled owner before listing uploads for reconciliation', async () => {
  expect((await request({ action: 'upload-sync' })).status).toBe(401)
  ownerRpc.mockResolvedValue({ data: false, error: null })
  expect((await request({ action: 'upload-sync' }, 'valid-jwt')).status).toBe(403)
  expect(provider).not.toHaveBeenCalled()
})

it('returns a private thumbnail only for an owned library recording', async () => {
  ownerRpc.mockImplementation(async (name) => ({
    data: name === 'is_library_owner' ? true : [{ id: 'owned', provider: 'stream', stream_video_id: id }],
    error: null,
  }))
  const response = await request({ action: 'thumbnail', recordingId: 'owned' }, 'valid-jwt')
  expect(response.status).toBe(200)
  const result = await response.json()
  const image = new URL(result.url)
  expect(image.pathname).toBe('/signed-playback/thumbnails/thumbnail.jpg')
  expect(image.searchParams.get('time')).toBe('0s')
  expect(image.searchParams.get('fit')).toBe('clip')
  expect(result.url).not.toContain(id)
  const claims = JSON.parse(provider.mock.calls[1][1].body)
  expect(claims.downloadable).toBe(false)
  expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300)
  provider.mockClear()
  expect((await request({ action: 'thumbnail', recordingId: 'other-owner' }, 'valid-jwt')).status).toBe(404)
  expect(provider).not.toHaveBeenCalled()
  expect((await request({ action: 'thumbnail', recordingId: 'owned' })).status).toBe(401)
})

it('samples the thumbnail a fifth of the way in once the duration is known', async () => {
  ownerRpc.mockImplementation(async (name) => ({
    data: name === 'is_library_owner' ? true : [{ id: 'owned', provider: 'stream', stream_video_id: id }],
    error: null,
  }))
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
                duration: 1801.5,
                playback: {
                  hls: `https://customer-example.cloudflarestream.com/${id}/manifest/video.m3u8`,
                },
              },
        }),
      ),
  )
  const response = await request({ action: 'thumbnail', recordingId: 'owned' }, 'valid-jwt')
  expect(response.status).toBe(200)
  expect(new URL((await response.json()).url).searchParams.get('time')).toBe('360s')
})
