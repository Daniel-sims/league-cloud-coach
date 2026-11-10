// Mirrors Domain/RecentGames.swift and Persistence/MatchHistoryFilter.swift.
export type Participant = {
  puuid: string
  teamId: number
  championId: number
  championName: string
  riotIdGameName?: string
  riotIdTagline?: string
  summonerName?: string
  teamPosition: string
  win: boolean
  gameEndedInEarlySurrender?: boolean
  kills: number
  deaths: number
  assists: number
  champLevel: number
  totalMinionsKilled: number
  neutralMinionsKilled: number
  goldEarned: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  wardsPlaced: number
  wardsKilled: number
  visionWardsBoughtInGame: number
  visionScore: number
  summoner1Id: number
  summoner2Id: number
  item0: number
  item1: number
  item2: number
  item3: number
  item4: number
  item5: number
  item6: number
  perks?: { styles: { selections: { perk: number }[] }[] }
}
export type LeagueMatch = {
  id: string
  queueId: number
  gameCreation: number
  gameDuration: number
  gameVersion: string
  participants: Participant[]
}
export type Rank = {
  queueType: string
  tier: string
  rank: string
  leaguePoints: number
  wins: number
  losses: number
}
export type LeagueProfile = {
  id: string
  platform: string
  puuid: string
  gameName: string
  tagLine: string
  profileIconId: number
  summonerLevel: number
  ranks: Rank[]
  syncedAt: string | null
  historyCursor?: number
}
export type Game = LeagueMatch & {
  player: Participant
  allies: Participant[]
  opponent?: Participant
}
// Preserve the filtered list's order and group by the viewer's local calendar day.
export function groupGamesByDay(games: Game[], timeZone?: string) {
  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  })
  const label = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  })
  const groups = new Map<string, { key: string; label: string; games: Game[] }>()
  for (const game of games) {
    const parts = Object.fromEntries(
      date.formatToParts(game.gameCreation).map((part) => [part.type, part.value]),
    )
    const key = `${parts.year}-${parts.month}-${parts.day}`
    let group = groups.get(key)
    if (!group) {
      group = { key, label: label.format(game.gameCreation), games: [] }
      groups.set(key, group)
    }
    group.games.push(game)
  }
  return [...groups.values()]
}
export const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
export const roleNames: Record<string, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'Bot',
  UTILITY: 'Support',
}
export const platforms: Record<string, string> = { euw1: 'EUW', eun1: 'EUNE', na1: 'NA', kr: 'KR' }
export const queues: Record<number, string> = {
  420: 'Ranked Solo/Duo',
  440: 'Ranked Flex',
  400: 'Normal Draft',
  430: 'Normal Blind',
  450: 'ARAM',
  490: 'Quickplay',
  1700: 'Arena',
}
export const championIcon = (id: number) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${id}.png`
export const number = (value: number, digits = 1) =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value)
export const percent = (value: number | null) =>
  value === null ? '—' : `${number(value * 100, 0)}%`
export const kda = (p: { kills: number; deaths: number; assists: number }) =>
  p.deaths ? `${number((p.kills + p.assists) / p.deaths, 2)}:1` : 'Perfect'
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
export const cs = (p: Participant) => p.totalMinionsKilled + p.neutralMinionsKilled
export const remake = (g: Game) => Boolean(g.player.gameEndedInEarlySurrender)
export function gamesFor(matches: LeagueMatch[], puuid: string): Game[] {
  return matches
    .flatMap((m) => {
      const player = m.participants.find((p) => p.puuid === puuid)
      if (!player) return []
      const allies = m.participants.filter((p) => p.teamId === player.teamId)
      const enemies = m.participants.filter((p) => p.teamId !== player.teamId)
      return [
        {
          ...m,
          player,
          allies,
          opponent:
            enemies.find((p) => player.teamPosition && p.teamPosition === player.teamPosition) ??
            enemies[allies.indexOf(player)],
        },
      ]
    })
    .sort((a, b) => b.gameCreation - a.gameCreation || b.id.localeCompare(a.id))
}
const sum = <T>(items: T[], value: (item: T) => number) =>
  items.reduce((n, item) => n + value(item), 0)
export function summary(window: Game[]) {
  const games = window.filter((g) => !remake(g))
  const counts = roles
    .map((role) => ({ role, games: games.filter((g) => g.player.teamPosition === role) }))
    .filter((r) => r.games.length)
    .sort(
      (a, b) =>
        b.games.length - a.games.length ||
        sum(b.games, (g) => +g.player.win) - sum(a.games, (g) => +g.player.win) ||
        roles.indexOf(a.role) - roles.indexOf(b.role),
    )
  const primaryRole = counts[0]?.role
  const scoped = primaryRole ? games.filter((g) => g.player.teamPosition === primaryRole) : games
  const minutes = sum(scoped, (g) => g.gameDuration) / 60
  const kills = sum(games, (g) => g.player.kills),
    deaths = sum(games, (g) => g.player.deaths),
    assists = sum(games, (g) => g.player.assists)
  const meanShare = (
    numerator: (p: Participant) => number,
    denominator: (p: Participant) => number,
  ) => {
    const ratios = scoped.flatMap((g) => {
      const d = sum(g.allies, denominator)
      return d > 0 ? [numerator(g.player) / d] : []
    })
    return ratios.length ? sum(ratios, (r) => r) / ratios.length : null
  }
  const wins = games.filter((g) => g.player.win).length
  return {
    games: games.length,
    wins,
    losses: games.length - wins,
    remakes: window.length - games.length,
    winRate: games.length ? wins / games.length : null,
    kills,
    deaths,
    assists,
    averageKills: kills / (games.length || 1),
    averageDeaths: deaths / (games.length || 1),
    averageAssists: assists / (games.length || 1),
    csPerMinute: minutes ? sum(scoped, (g) => cs(g.player)) / minutes : 0,
    goldPerMinute: minutes ? sum(scoped, (g) => g.player.goldEarned) / minutes : 0,
    killParticipation: meanShare(
      (p) => p.kills + p.assists,
      (p) => p.kills,
    ),
    damageShare: meanShare(
      (p) => p.totalDamageDealtToChampions,
      (p) => p.totalDamageDealtToChampions,
    ),
    averageDuration: sum(games, (g) => g.gameDuration) / (games.length || 1),
    primaryRole,
    roles: counts,
    streak: games.length
      ? {
          win: games[0].player.win,
          count:
            games.findIndex((g) => g.player.win !== games[0].player.win) < 0
              ? games.length
              : games.findIndex((g) => g.player.win !== games[0].player.win),
        }
      : null,
  }
}
export type HistoryFilter = {
  champion: string
  opponent: string
  role: string
  queue: string
  patch: string
  result: string
  oldest: boolean
}
export const emptyFilter: HistoryFilter = {
  champion: '',
  opponent: '',
  role: '',
  queue: '',
  patch: '',
  result: '',
  oldest: false,
}
export function filterGames(games: Game[], f: HistoryFilter, includeResult = true) {
  return games
    .filter(
      (g) =>
        (!f.champion || String(g.player.championId) === f.champion) &&
        (!f.opponent ||
          g.participants.some(
            (p) =>
              p.teamId !== g.player.teamId &&
              String(p.championId) === f.opponent &&
              (!g.player.teamPosition || p.teamPosition === g.player.teamPosition),
          )) &&
        (!f.role || g.player.teamPosition === f.role) &&
        (!f.queue || String(g.queueId) === f.queue) &&
        (!f.patch || g.gameVersion.split('.').slice(0, 2).join('.') === f.patch) &&
        (!includeResult ||
          !f.result ||
          (!remake(g) && (g.player.win ? 'win' : 'loss') === f.result)),
    )
    .sort((a, b) => (f.oldest ? a.gameCreation - b.gameCreation : b.gameCreation - a.gameCreation))
}
export function championGroups(games: Game[]) {
  const ids = [...new Set(games.filter((g) => !remake(g)).map((g) => g.player.championId))]
  return ids
    .map((id) => {
      const list = games.filter((g) => g.player.championId === id)
      const stats = summary(list)
      const decided = list.filter((g) => !remake(g))
      const minutes = sum(decided, (g) => g.gameDuration) / 60
      // Native champion rows use all games on that champion, including off-role games.
      return {
        id,
        name: list[0].player.championName,
        summary: {
          ...stats,
          csPerMinute: minutes ? sum(decided, (g) => cs(g.player)) / minutes : 0,
        },
      }
    })
    .sort(
      (a, b) =>
        b.summary.games - a.summary.games ||
        b.summary.wins - a.summary.wins ||
        a.name.localeCompare(b.name),
    )
}
// Native Domain/SeasonSplit.swift: season is the major version, never calendar year.
export function seasonOf(g: LeagueMatch) {
  return Number(g.gameVersion.split('.')[0]) || 0
}
export function splitOf(g: LeagueMatch) {
  const starts = seasonOf(g) === 16 ? [1, 9, 15] : []
  const patch = Number(g.gameVersion.split('.')[1])
  const count = starts.filter((start) => patch >= start).length
  return count || null
}
