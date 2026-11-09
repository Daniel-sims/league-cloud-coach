import { createClient } from '@supabase/supabase-js'
import type { LibraryRepository, Recording, WatchVideo } from './types'

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
    if (error.code === '23505') throw new Error('This YouTube video is already in your library.')
    if (error.code === '42501')
      throw new Error('This account does not have permission to manage this library.')
    if (error.code === 'PGRST202')
      throw new Error('The database setup needs to be completed. See web/README.md.')
    throw new Error(error.message || 'Could not reach your library. Please try again.')
  }
  return data as T
}

export const cloudRepository: LibraryRepository = {
  list: () => rpc<Recording[]>('list_recordings'),
  add: (input) =>
    rpc('add_recording', {
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
  const error = current.searchParams.get('error_description')
  const code = current.searchParams.get('code')
  if (!error && !code) return null
  // Remove sensitive OAuth response parameters from history even on failure.
  current.search = ''
  current.hash = '/library'
  history.replaceState(null, '', current)
  if (error) return 'Google sign-in was cancelled or could not be completed. Please try again.'
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
