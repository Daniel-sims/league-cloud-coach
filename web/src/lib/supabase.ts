import { createClient } from '@supabase/supabase-js'
import { oauthErrorMessage } from './auth-errors'
import type { LibraryRepository, Recording, WatchVideo, UploadSync } from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const configured = Boolean(url && key && url !== 'https://your-project.supabase.co')
export const supabase = configured
  ? createClient(url!, key!, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('The cloud connection has not been configured yet.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (error.code === '23505') throw new Error('This video is already in your library.')
    if (error.code === '42501')
      throw new Error('This account does not have permission to manage this library.')
    if (error.code === 'PGRST202')
      throw new Error('The database setup needs to be completed. See web/README.md.')
    throw new Error(error.message || 'Could not reach your library. Please try again.')
  }
  return data as T
}

export const cloudRepository: LibraryRepository = {
  syncUploads: () => streamRequest<UploadSync>('upload-sync', {}),
  list: () => rpc<Recording[]>('list_recordings'),
  add: (input) =>
    input.provider === 'stream'
      ? streamRequest('add', {
          videoId: input.stream_video_id,
          title: input.title,
          recordedOn: input.recorded_on,
        }).then(() => {})
      : rpc('add_recording', {
          p_title: input.title,
          p_video_id: input.youtube_video_id,
          p_recorded_on: input.recorded_on,
        }),
  rename: (id, title) => rpc('rename_recording', { p_id: id, p_title: title }),
  remove: (id) => rpc('remove_recording', { p_id: id }),
  share: (id) => rpc<string>('create_recording_share', { p_id: id }),
  revoke: (id) => rpc('revoke_recording_share', { p_id: id }),
}

export async function resolveShare(token: string): Promise<WatchVideo | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const result = await rpc<WatchVideo[]>('resolve_recording_share', { p_token: token })
  return result[0] ?? null
}

export async function initializeAuth(): Promise<string | null> {
  if (!supabase) return null
  const current = new URL(window.location.href)
  const fragment = new URLSearchParams(current.hash.slice(1))
  const description =
    current.searchParams.get('error_description') || fragment.get('error_description')
  const error = current.searchParams.get('error') || fragment.get('error')
  const errorCode = current.searchParams.get('error_code') || fragment.get('error_code')
  const code = current.searchParams.get('code')
  const hasProviderError = Boolean(error || description || errorCode)
  if (!hasProviderError && !code) return null
  // Remove sensitive OAuth response parameters from history even on failure.
  current.search = ''
  current.hash = '/home'
  history.replaceState(null, '', current)
  if (hasProviderError) return oauthErrorMessage(error, errorCode, description)
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError)
      return 'Your sign-in link expired or was opened in another browser. Please sign in again.'
  }
  return null
}

export function appURL(path: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = path
  return url.toString()
}

export type PlaybackLease = { url: string; expiresAt: string; sessionExpiresAt: string | null }
export class StreamAccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function streamRequest<T = PlaybackLease>(
  action: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error('The cloud connection has not been configured yet.')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const response = await fetch(`${url}/functions/v1/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key!,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ action, ...args }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new StreamAccessError(
      data.error || 'Could not prepare the video. Please try again.',
      response.status,
    )
  return data as T
}

// Kept per tab: refresh resumes the same claim, another browser cannot claim it.
export function viewerSession(token: string): string {
  const storageKey = `stream-session:${token}`
  let session = sessionStorage.getItem(storageKey)
  if (!session || !/^[a-f0-9]{64}$/.test(session)) {
    session = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('')
    sessionStorage.setItem(storageKey, session)
  }
  return session
}
