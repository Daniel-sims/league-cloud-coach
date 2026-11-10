// Kept runtime-independent so authorization and provider failures can be tested.
import type { SupabaseClient } from '@supabase/supabase-js'
import { provisionUpload, validUpload } from './uploads.ts'
import { reconcileUploads, rememberedImports, recordingDate } from './reconcile.ts'

type Dependencies = {
  env(key: string): string | undefined
  createClient(url: string, key: string, options?: object): SupabaseClient
  fetch: typeof fetch
}
class Failure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
const capability = /^[a-f0-9]{64}$/
const videoID = /^[a-f0-9]{32}$/

export function createStreamHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    }
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
    try {
      const raw = await request.text()
      if (raw.length > 4096) throw new Failure(413, 'Request too large.')
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        throw new Failure(400, 'Invalid request.')
      }
      if (!body || typeof body !== 'object') throw new Failure(400, 'Invalid request.')
      const account = deps.env('CLOUDFLARE_ACCOUNT_ID')
      const apiToken = deps.env('CLOUDFLARE_API_TOKEN')
      if (!account || !videoID.test(account) || !apiToken)
        throw new Failure(503, 'Video hosting is not configured yet.')
      const url = deps.env('SUPABASE_URL')!
      const admin = deps.createClient(url, deps.env('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      async function cloudflare(path: string, init?: RequestInit) {
        const response = await deps.fetch(
          `https://api.cloudflare.com/client/v4/accounts/${account}/stream${path.startsWith('?') ? path : `/${path}`}`,
          {
            ...init,
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
          },
        )
        if (!response.ok)
          throw new Failure(502, 'Cloudflare could not prepare this video. Please try again.')
        const data = await response.json()
        if (!data.success || !data.result)
          throw new Failure(502, 'Cloudflare could not prepare this video. Please try again.')
        return data.result
      }
      // No public endpoint accepts an arbitrary video ID for signing.
      let id: string
      let sessionExpires: string | null = null
      if (body.action === 'start' || body.action === 'renew') {
        if (
          typeof body.token !== 'string' ||
          typeof body.session !== 'string' ||
          !capability.test(body.token) ||
          !capability.test(body.session)
        )
          throw new Failure(400, 'Invalid watch link.')
        const { data, error } = await admin.rpc('authorize_stream_share', {
          p_token: body.token,
          p_session: body.session,
          p_start: body.action === 'start',
        })
        if (error) throw new Failure(503, 'Could not check this session. Please try again.')
        if (!data?.[0])
          throw new Failure(
            410,
            'This session is unavailable, expired, or open in another browser. Ask the owner for a new link.',
          )
        id = data[0].stream_video_id
        sessionExpires = data[0].session_expires_at
      } else if (
        ['owner', 'thumbnail', 'add', 'upload-create', 'upload-status', 'upload-sync'].includes(body.action)
      ) {
        const jwt = request.headers.get('Authorization')?.replace(/^Bearer /, '')
        if (!jwt) throw new Failure(401, 'Sign in to manage your library.')
        const { data: auth, error: authError } = await admin.auth.getUser(jwt)
        if (authError || !auth.user) throw new Failure(401, 'Sign in to manage your library.')
        const owner = deps.createClient(url, deps.env('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const { data: member, error: memberError } = await owner.rpc('is_library_owner')
        if (memberError || !member) throw new Failure(403, 'Library owner access required.')
        if (body.action === 'upload-sync') {
          const videos = await cloudflare(`?creator=${encodeURIComponent(auth.user.id)}&limit=1000`)
          if (!Array.isArray(videos))
            throw new Failure(502, 'Could not refresh uploads. Try again.')
          return reply(await reconcileUploads({ admin, ownerId: auth.user.id, videos }))
        }
        if (body.action === 'upload-create') {
          if (!validUpload(body))
            throw new Failure(
              400,
              'Choose a supported video up to 30 GB, a title, and a maximum length of 30–120 minutes.',
            )
          try {
            return reply(
              await provisionUpload({
                account,
                apiToken,
                ownerId: auth.user.id,
                input: body,
                fetch: deps.fetch,
              }),
            )
          } catch {
            throw new Failure(
              502,
              'Could not reserve this upload. Check Cloudflare storage capacity and try again.',
            )
          }
        }
        if (body.action === 'upload-status') {
          if (typeof body.videoId !== 'string' || !videoID.test(body.videoId))
            throw new Failure(400, 'Choose an upload.')
          const video = await cloudflare(body.videoId)
          if (video.creator !== auth.user.id || video.meta?.appupload !== 'true')
            throw new Failure(404, 'Upload unavailable.')
          if (!video.requireSignedURLs)
            throw new Failure(
              409,
              'This upload is not private. Enable Require signed URLs in Cloudflare before continuing.',
            )
          if (video.status?.state === 'error')
            return reply({
              state: 'error',
              message:
                'Cloudflare could not process this video. Check its format and maximum length in Cloudflare.',
            })
          if (!video.readyToStream)
            return reply({
              state: ['pendingupload', 'uploading'].includes(video.status?.state)
                ? 'uploading'
                : 'processing',
            })
          const title = typeof video.meta?.name === 'string' ? video.meta.name.trim() : ''
          if (!title || title.length > 160)
            throw new Failure(400, 'Set a title for this recording in Cloudflare first.')
          const imports = await rememberedImports(admin, auth.user.id)
          if (imports.has(body.videoId)) {
            const { data: rows, error: listError } = await owner.rpc('list_recordings')
            if (listError) throw new Failure(503, 'Could not check your library. Try again.')
            const saved = rows?.find(
              (row: { stream_video_id: string }) => row.stream_video_id === body.videoId,
            )
            return reply(
              saved
                ? { state: 'ready', recordingId: saved.id }
                : {
                    state: 'error',
                    message:
                      'This video was removed from your library. Use Add existing video to restore it.',
                  },
            )
          }
          const { data: recordingId, error } = await admin.rpc('add_stream_recording', {
            p_owner: auth.user.id,
            p_title: title,
            p_video_id: body.videoId,
            p_recorded_on: recordingDate(video.meta.recordedon),
          })
          if (error && error.code !== '23505')
            throw new Failure(
              503,
              'The video is ready, but could not be added. Try checking again.',
            )
          let savedId = recordingId
          if (typeof savedId !== 'string') {
            // A library reconciliation request may have won the insertion race.
            const { data: rows, error: listError } = await owner.rpc('list_recordings')
            savedId = rows?.find(
              (row: { stream_video_id: string }) => row.stream_video_id === body.videoId,
            )?.id
            if (listError || !savedId)
              throw new Failure(503, 'Could not confirm the library save. Try checking again.')
          }
          return reply({ state: 'ready', recordingId: savedId })
        }
        if (body.action === 'add') {
          if (
            typeof body.videoId !== 'string' ||
            !videoID.test(body.videoId) ||
            typeof body.title !== 'string' ||
            !body.title.trim() ||
            body.title.trim().length > 160
          )
            throw new Failure(400, 'Enter a Stream video ID and a title.')
          const video = await cloudflare(body.videoId)
          if (video.uid !== body.videoId || !video.requireSignedURLs)
            throw new Failure(400, 'Enable Require signed URLs for this video in Cloudflare first.')
          if (!video.readyToStream)
            throw new Failure(
              400,
              'This video is still processing. Wait until it is ready in Cloudflare.',
            )
          const { error } = await admin.rpc('add_stream_recording', {
            p_owner: auth.user.id,
            p_title: body.title.trim(),
            p_video_id: body.videoId,
            p_recorded_on: body.recordedOn || null,
          })
          if (error?.code === '23505')
            throw new Failure(409, 'This video is already in your library.')
          if (error) throw new Failure(400, 'Could not add this video. Check the title and date.')
          return reply({ ok: true })
        }
        if (typeof body.recordingId !== 'string') throw new Failure(400, 'Choose a recording.')
        const { data: rows, error } = await owner.rpc('list_recordings')
        const record = rows?.find((r: { id: string }) => r.id === body.recordingId)
        if (error || !record || record.provider !== 'stream')
          throw new Failure(404, 'Recording unavailable.')
        id = record.stream_video_id
      } else throw new Failure(400, 'Unknown video action.')
      // Re-check privacy on every lease; a dashboard change must fail closed.
      const video = await cloudflare(id)
      if (!video.readyToStream || !video.requireSignedURLs)
        throw new Failure(409, 'This video is not ready for private playback. Contact the owner.')
      const now = Math.floor(Date.now() / 1000)
      const exp = Math.min(
        now + 300,
        sessionExpires ? Math.floor(Date.parse(sessionExpires) / 1000) : now + 300,
      )
      if (exp <= now)
        throw new Failure(410, 'This session has expired. Ask the owner for a new link.')
      const signed = await cloudflare(`${id}/token`, {
        method: 'POST',
        body: JSON.stringify({ exp, downloadable: false }),
      })
      const playback = new URL(video.playback.hls)
      if (!/^customer-[a-zA-Z0-9-]+\.cloudflarestream\.com$/.test(playback.hostname))
        throw new Failure(502, 'Unexpected video host.')
      if (body.action === 'thumbnail') {
        playback.pathname = `/${signed.token}/thumbnails/thumbnail.jpg`
        playback.search = new URLSearchParams({ time: '0s', height: '180', fit: 'clip' }).toString()
        return reply({ url: playback.href, expiresAt: new Date(exp * 1000).toISOString() })
      }
      playback.pathname = `/${signed.token}/manifest/video.m3u8`
      playback.search = ''
      return reply({
        url: playback.href,
        expiresAt: new Date(exp * 1000).toISOString(),
        sessionExpiresAt: sessionExpires,
      })
    } catch (error) {
      // Never log or echo provider responses, credentials, JWTs, or capabilities.
      return reply(
        {
          error:
            error instanceof Failure
              ? error.message
              : 'Video service unavailable. Please try again.',
        },
        error instanceof Failure ? error.status : 503,
      )
    }
  }
}
