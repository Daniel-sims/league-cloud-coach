import { rpc, supabase } from './supabase'
import type { LeagueMatch, LeagueProfile } from './league'

export interface LeagueRepository {
  profiles(): Promise<LeagueProfile[]>
  matches(id: string): Promise<LeagueMatch[]>
  connect(riotId: string, platform: string): Promise<{ id: string }>
  viewPlayer(platform: string, puuid: string): Promise<{ id: string }>
  removeProfile(id: string): Promise<void>
  refreshProfile(id: string): Promise<void>
  sync(id: string, start: number): Promise<{ nextStart: number; hasMore: boolean }>
}
export async function riotRequest<T>(body: object): Promise<T> {
  if (!supabase) throw new Error('Sign in to connect your League account.')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in again to continue.')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/riot`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Could not sync League. Please try again.')
  return result as T
}
export const leagueRepository: LeagueRepository = {
  profiles: () => rpc('list_league_profiles'),
  matches: (id) => rpc('list_league_matches', { p_profile: id }),
  connect: (riotId, platform) => riotRequest({ action: 'connect', riotId, platform }),
  viewPlayer: (platform, puuid) => riotRequest({ action: 'view-player', platform, puuid }),
  removeProfile: async (id) => {
    await riotRequest({ action: 'remove-profile', profileId: id })
  },
  refreshProfile: (id) => riotRequest({ action: 'refresh-profile', profileId: id }),
  sync: (id, start) => riotRequest({ action: 'sync', profileId: id, start }),
}
