import { rpc, supabase } from './supabase'
import type { LeagueMatch, LeagueProfile, Rank } from './league'
import { cachedMatches, storedMatches, type ChangeCursor, type ChangePage } from './match-cache'

export type ViewedProfile = Pick<
  LeagueProfile,
  'gameName' | 'tagLine' | 'profileIconId' | 'summonerLevel' | 'ranks'
>

export interface LeagueRepository {
  profiles(): Promise<LeagueProfile[]>
  matches(id: string): Promise<LeagueMatch[]>
  /** Games already kept in this browser, to show while matches() refreshes. */
  storedMatches?(id: string): Promise<LeagueMatch[] | null>
  /** Match id -> recording id for games the owner has uploaded video for. */
  matchRecordings?(): Promise<Record<string, string>>
  connect(riotId: string, platform: string): Promise<{ id: string }>
  findPlayer(platform: string, riotId: string): Promise<{ puuid: string; profile: ViewedProfile }>
  viewPlayer(platform: string, puuid: string): Promise<{ profile: ViewedProfile }>
  viewMatches(
    platform: string,
    puuid: string,
    start: number,
    known: string[],
  ): Promise<{ ids: string[]; matches: LeagueMatch[]; nextStart: number; hasMore: boolean }>
  matchRanks(platform: string, puuids: string[]): Promise<{ ranks: Record<string, Rank[]> }>
  refreshProfile(id: string): Promise<void>
  sync(
    id: string,
    start: number,
    window?: { startTime: number; endTime: number },
  ): Promise<{ nextStart: number; hasMore: boolean }>
  syncTimelines(
    id: string,
    window?: { startTime: number; endTime: number },
  ): Promise<{ done: number; remaining: number }>
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
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Could not sync League. Please try again.'), {
      retryAfter: typeof result.retryAfter === 'number' ? result.retryAfter : undefined,
    })
  return result as T
}
const fetchMatchChanges = (id: string, after: ChangeCursor | null, limit: number) =>
  rpc<ChangePage>('list_league_match_changes', {
    p_profile: id,
    p_after: after?.at ?? null,
    p_after_id: after?.id ?? null,
    p_limit: limit,
  })

export const leagueRepository: LeagueRepository = {
  profiles: () => rpc('list_league_profiles'),
  matches: (id) => cachedMatches(id, fetchMatchChanges),
  storedMatches,
  matchRecordings: () => rpc<Record<string, string>>('list_match_recordings'),
  connect: (riotId, platform) => riotRequest({ action: 'connect', riotId, platform }),
  findPlayer: (platform, riotId) => riotRequest({ action: 'find-player', platform, riotId }),
  viewPlayer: (platform, puuid) => riotRequest({ action: 'view-player', platform, puuid }),
  viewMatches: (platform, puuid, start, known) =>
    riotRequest({ action: 'view-matches', platform, puuid, start, known }),
  matchRanks: (platform, puuids) => riotRequest({ action: 'match-ranks', platform, puuids }),
  refreshProfile: (id) => riotRequest({ action: 'refresh-profile', profileId: id }),
  sync: (id, start, window) => riotRequest({ action: 'sync', profileId: id, start, ...window }),
  syncTimelines: (id, window) =>
    riotRequest({ action: 'sync-timelines', profileId: id, ...window }),
}
