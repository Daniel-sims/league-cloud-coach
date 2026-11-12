import type { LeagueMatch, LeagueProfile } from './league'

// Players opened from a scoreboard are never stored on the server. The browser keeps
// the most recent few so reopening one is instant; everything here is optional.
export type ViewedPlayer = { profile: LeagueProfile; matches: LeagueMatch[] }
const maxPlayers = 6
export const maxViewedGames = 60
const indexKey = (owner: string) => `league-viewed:${owner}`
const entryKey = (owner: string, platform: string, puuid: string) =>
  `league-viewed:${owner}:${platform}:${puuid}`

function readIndex(owner: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(indexKey(owner)) || '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}
export function loadViewed(owner: string, platform: string, puuid: string): ViewedPlayer | null {
  try {
    const value = JSON.parse(localStorage.getItem(entryKey(owner, platform, puuid)) || 'null')
    return value && value.profile && Array.isArray(value.matches) ? value : null
  } catch {
    return null
  }
}
export function saveViewed(owner: string, platform: string, puuid: string, data: ViewedPlayer) {
  const key = entryKey(owner, platform, puuid)
  try {
    const index = [key, ...readIndex(owner).filter((k) => k !== key)]
    for (const old of index.splice(maxPlayers)) localStorage.removeItem(old)
    localStorage.setItem(
      key,
      JSON.stringify({ ...data, matches: data.matches.slice(0, maxViewedGames) }),
    )
    localStorage.setItem(indexKey(owner), JSON.stringify(index))
  } catch {
    /* a full or blocked store just means no cache */
  }
}

// Most recent lookups first, for the Summoners page.
export function listViewed(
  owner: string,
): { platform: string; puuid: string; profile: LeagueProfile }[] {
  const prefix = `league-viewed:${owner}:`
  const found: { platform: string; puuid: string; profile: LeagueProfile }[] = []
  for (const key of readIndex(owner)) {
    if (!key.startsWith(prefix)) continue
    const [platform, puuid] = key.slice(prefix.length).split(':')
    const entry = loadViewed(owner, platform, puuid)
    if (entry) found.push({ platform, puuid, profile: entry.profile })
  }
  return found
}
