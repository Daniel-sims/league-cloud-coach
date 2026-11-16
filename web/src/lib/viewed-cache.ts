import type { LeagueMatch, LeagueProfile } from './league'
import { readStored, writeStored } from './match-cache'

// Players opened from a scoreboard are never stored on the server. The browser
// keeps the most recent few (in IndexedDB, wiped on sign-out with the match
// history) so reopening one is instant; everything here is optional.
export type ViewedPlayer = { profile: LeagueProfile; matches: LeagueMatch[] }
export type RecentPlayer = { platform: string; puuid: string; profile: LeagueProfile }
const maxPlayers = 6
export const maxViewedGames = 60
const indexKey = (owner: string) => `viewed:${owner}`
const entryKey = (owner: string, platform: string, puuid: string) =>
  `viewed:${owner}:${platform}:${puuid}`

// Earlier versions kept these in localStorage (~400 KB a player, read
// synchronously). Move this owner's into IndexedDB once and drop the rest.
const legacyPrefix = 'league-viewed:'
let migrated: Promise<void> | undefined
function migrate(owner: string) {
  migrated ??= (async () => {
    let legacy: RecentPlayer[] = []
    const entries: [string, ViewedPlayer][] = []
    try {
      const index = JSON.parse(localStorage.getItem(legacyPrefix + owner) || '[]')
      for (const key of Array.isArray(index) ? index : []) {
        if (typeof key !== 'string' || !key.startsWith(`${legacyPrefix}${owner}:`)) continue
        const [platform, puuid] = key.slice(`${legacyPrefix}${owner}:`.length).split(':')
        const value = JSON.parse(localStorage.getItem(key) || 'null')
        if (!value?.profile || !Array.isArray(value.matches)) continue
        legacy.push({ platform, puuid, profile: value.profile })
        entries.push([entryKey(owner, platform, puuid), value])
      }
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key?.startsWith(legacyPrefix)) localStorage.removeItem(key)
      }
    } catch {
      legacy = []
    }
    if (!legacy.length || (await readStored(indexKey(owner)))) return
    for (const [key, value] of entries) await writeStored(key, value)
    await writeStored(indexKey(owner), legacy.slice(0, maxPlayers))
  })()
  return migrated
}

const isRecent = (v: unknown): v is RecentPlayer =>
  !!v &&
  typeof (v as RecentPlayer).platform === 'string' &&
  typeof (v as RecentPlayer).puuid === 'string' &&
  !!(v as RecentPlayer).profile

/** Most recent lookups first, for the Summoners page. Reads only the small index. */
export async function listViewed(owner: string): Promise<RecentPlayer[]> {
  await migrate(owner)
  const index = await readStored<unknown>(indexKey(owner))
  return Array.isArray(index) ? index.filter(isRecent) : []
}

export async function loadViewed(
  owner: string,
  platform: string,
  puuid: string,
): Promise<ViewedPlayer | null> {
  await migrate(owner)
  const value = await readStored<ViewedPlayer>(entryKey(owner, platform, puuid))
  return value && value.profile && Array.isArray(value.matches) ? value : null
}

export async function saveViewed(
  owner: string,
  platform: string,
  puuid: string,
  data: ViewedPlayer,
) {
  await migrate(owner)
  const recent = await listViewed(owner)
  const next = [
    { platform, puuid, profile: data.profile },
    ...recent.filter((r) => r.platform !== platform || r.puuid !== puuid),
  ]
  for (const old of next.splice(maxPlayers))
    await writeStored(entryKey(owner, old.platform, old.puuid), undefined)
  await writeStored(entryKey(owner, platform, puuid), {
    ...data,
    matches: data.matches.slice(0, maxViewedGames),
  })
  await writeStored(indexKey(owner), next)
}

/** Test hook: forget that the one-time localStorage move already ran. */
export function resetViewedMigration() {
  migrated = undefined
}
