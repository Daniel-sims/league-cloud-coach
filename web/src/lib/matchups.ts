import { rpc } from './supabase'
import { championLabel } from './champions'
import { cs, remake, type Game } from './league'
import type { LiveSeat } from './league-repository'

// Matchups: notes for one champion into one lane opponent, plus history stats.

export type Difficulty = 'easy' | 'even' | 'hard'

export interface MatchupDraft {
  difficulty: Difficulty | null
  /** One line: the plan to read in champion select. */
  plan: string
  /** What the opponent does that punishes you. */
  threats: string[]
  /** How you win the lane. */
  tips: string[]
  /** Runes, items, spells. */
  build: string
  notes: string
}

export interface MatchupNote extends MatchupDraft {
  championId: number
  opponentId: number
  /** 0 until the first save creates the note. */
  revision: number
  updatedAt?: string
}

export const emptyDraft: MatchupDraft = {
  difficulty: null,
  plan: '',
  threats: [],
  tips: [],
  build: '',
  notes: '',
}

export const cleanDraft = (draft: MatchupDraft): MatchupDraft => ({
  difficulty: draft.difficulty,
  plan: draft.plan.trim(),
  threats: draft.threats.map((p) => p.trim()).filter(Boolean),
  tips: draft.tips.map((p) => p.trim()).filter(Boolean),
  build: draft.build.trim(),
  notes: draft.notes.trim(),
})

export const hasContent = (note: MatchupDraft) => {
  const c = cleanDraft(note)
  return Boolean(c.difficulty || c.plan || c.threats.length || c.tips.length || c.build || c.notes)
}

/** Per-minute lane differences, you minus your lane opponent: [seconds, gold, cs, xp]. */
export type LaneFrame = [number, number, number, number]
export type Lanes = Record<string, LaneFrame[]>

export interface MatchupRepository {
  list(): Promise<MatchupNote[]>
  save(
    championId: number,
    opponentId: number,
    revision: number,
    draft: MatchupDraft,
  ): Promise<MatchupNote>
  remove(championId: number, opponentId: number): Promise<void>
  lanes(matchIds: string[]): Promise<Lanes>
}

export const matchupRepository: MatchupRepository = {
  list: () => rpc('list_matchups'),
  save: (championId, opponentId, revision, draft) =>
    rpc('save_matchup', {
      p_champion: championId,
      p_opponent: opponentId,
      p_revision: revision,
      p_note: cleanDraft(draft),
    }),
  remove: (championId, opponentId) =>
    rpc('delete_matchup', { p_champion: championId, p_opponent: opponentId }),
  lanes: (matchIds) =>
    matchIds.length
      ? rpc('list_matchup_lanes', { p_matches: matchIds.slice(0, 500) })
      : Promise.resolve({}),
}

export const matchupPath = (championId: number, opponentId: number, stats = false) =>
  `#/matchups/${championId}/${opponentId}${stats ? '/stats' : ''}`

// Every champion, from Data Dragon (cached by the service worker). Falls back to
// the champions seen in synced games if Data Dragon can't be reached.
export type ChampionOption = { id: number; name: string }
let catalogue: Promise<ChampionOption[]> | undefined
export function championCatalogue(): Promise<ChampionOption[]> {
  catalogue ??= fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => r.json())
    .then((versions: string[]) =>
      fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`, {
        signal: AbortSignal.timeout(5000),
      }),
    )
    .then((r) => r.json())
    .then((json: { data: Record<string, { key: string; name: string }> }) =>
      Object.values(json.data).map((c) => ({ id: Number(c.key), name: c.name })),
    )
    .catch(() => {
      catalogue = undefined
      return []
    })
  return catalogue
}

/** Catalogue plus anything only seen in games (a champion newer than the cached catalogue). */
export function championOptions(catalogue: ChampionOption[], games: Game[]): ChampionOption[] {
  const byId = new Map(catalogue.map((c) => [c.id, c.name]))
  for (const g of games)
    for (const p of g.participants)
      if (p.championId > 0 && !byId.has(p.championId))
        byId.set(p.championId, championLabel(p.championName))
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export function searchChampions(options: ChampionOption[], query: string, limit = 8) {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!q) return options.slice(0, limit)
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const starts = options.filter((c) => key(c.name).startsWith(q))
  const words = options.filter(
    (c) =>
      !starts.includes(c) &&
      c.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((w) => w.startsWith(q)),
  )
  const contains = options.filter(
    (c) => !starts.includes(c) && !words.includes(c) && key(c.name).includes(q),
  )
  return [...starts, ...words, ...contains].slice(0, limit)
}

/** A game with a real lane opponent: same position, other team (not ARAM or Arena). */
export const laned = (g: Game) =>
  Boolean(g.player.teamPosition && g.opponent?.teamPosition === g.player.teamPosition)

/** Games where you faced this lane opponent, optionally only on one champion. Newest first. */
export function matchupGames<T extends Game>(
  games: T[],
  opponentId: number,
  championId: number | null,
) {
  return games.filter(
    (g) =>
      laned(g) &&
      g.opponent!.championId === opponentId &&
      (championId === null || g.player.championId === championId),
  )
}

export type Pairing = { championId: number; opponentId: number; games: Game[]; wins: number }
/** Your most-played champion/opponent pairs, by decided games. */
export function pairings(games: Game[]): Pairing[] {
  const map = new Map<string, Pairing>()
  for (const g of games) {
    if (!laned(g) || remake(g)) continue
    const key = `${g.player.championId}:${g.opponent!.championId}`
    const entry = map.get(key) ?? {
      championId: g.player.championId,
      opponentId: g.opponent!.championId,
      games: [],
      wins: 0,
    }
    entry.games.push(g)
    if (g.player.win) entry.wins++
    map.set(key, entry)
  }
  return [...map.values()].sort(
    (a, b) => b.games.length - a.games.length || b.wins - a.wins || a.championId - b.championId,
  )
}

export type LaneMetric = 'gold' | 'cs' | 'xp'
const metricIndex: Record<LaneMetric, 1 | 2 | 3> = { gold: 1, cs: 2, xp: 3 }
export const frameMinute = (f: LaneFrame) => Math.round(f[0] / 60)
export const frameValue = (f: LaneFrame, metric: LaneMetric) => f[metricIndex[metric]]

/** The difference at a minute mark, from the frame nearest that minute (Riot stamps frames a little late). */
export function laneAt(frames: LaneFrame[] | undefined, minute: number, metric: LaneMetric) {
  if (!frames) return null
  const frame = frames.find((f) => frameMinute(f) === minute)
  return frame ? frameValue(frame, metric) : null
}

export type CurvePoint = {
  minute: number
  all: number | null
  wins: number | null
  losses: number | null
  count: number
}
/** Average difference per minute across games, split by result. Remakes are left out. */
export function laneCurve(games: Game[], lanes: Lanes, metric: LaneMetric, maxMinute: number) {
  const points: CurvePoint[] = []
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  for (let minute = 0; minute <= maxMinute; minute++) {
    const won: number[] = [],
      lost: number[] = []
    for (const g of games) {
      if (remake(g)) continue
      const value = laneAt(lanes[g.id], minute, metric)
      if (value === null) continue
      ;(g.player.win ? won : lost).push(value)
    }
    points.push({
      minute,
      all: mean([...won, ...lost]),
      wins: mean(won),
      losses: mean(lost),
      count: won.length + lost.length,
    })
  }
  return points
}

const perMinute = (value: number, g: Game) => (g.gameDuration ? (value * 60) / g.gameDuration : 0)
export const comparisonStats: {
  key: string
  label: string
  lowerIsBetter?: boolean
  digits: number
  value: (p: Game['player'], g: Game) => number
}[] = [
  { key: 'kills', label: 'Kills', digits: 1, value: (p) => p.kills },
  { key: 'deaths', label: 'Deaths', digits: 1, lowerIsBetter: true, value: (p) => p.deaths },
  { key: 'assists', label: 'Assists', digits: 1, value: (p) => p.assists },
  { key: 'cs', label: 'CS / min', digits: 1, value: (p, g) => perMinute(cs(p), g) },
  { key: 'gold', label: 'Gold / min', digits: 0, value: (p, g) => perMinute(p.goldEarned, g) },
  {
    key: 'damage',
    label: 'Damage / min',
    digits: 0,
    value: (p, g) => perMinute(p.totalDamageDealtToChampions, g),
  },
  { key: 'vision', label: 'Vision / min', digits: 2, value: (p, g) => perMinute(p.visionScore, g) },
]

/** Your average against your lane opponent's, per stat, over decided games. */
export function headToHead(games: Game[]) {
  const decided = games.filter((g) => !remake(g) && laned(g))
  return comparisonStats.map((stat) => {
    const avg = (pick: (g: Game) => number) =>
      decided.length ? decided.reduce((n, g) => n + pick(g), 0) / decided.length : 0
    return {
      ...stat,
      you: avg((g) => stat.value(g.player, g)),
      them: avg((g) => stat.value(g.opponent!, g)),
    }
  })
}

const smite = 11
const mostCommon = (positions: string[]) => {
  const counts = new Map<string, number>()
  for (const p of positions) if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/**
 * Riot's live game has no positions, so guess your lane and your lane opponent
 * from your synced games: the lane you usually play this champion in, and the
 * enemy whose champion most often plays that lane in games you've seen.
 * Smite marks the jungler. Returns null opponent when there's nothing to go on.
 */
export function guessLaneOpponent(
  championId: number,
  enemies: LiveSeat[],
  games: Game[],
): { role: string | null; opponentId: number | null } {
  const role =
    mostCommon(
      games.filter((g) => g.player.championId === championId).map((g) => g.player.teamPosition),
    ) ?? mostCommon(games.map((g) => g.player.teamPosition))
  if (!role || !enemies.length) return { role, opponentId: null }
  const junglers = enemies.filter((e) => e.spells.includes(smite))
  if (role === 'JUNGLE')
    return { role, opponentId: junglers.length === 1 ? junglers[0].championId : null }
  const laners = enemies.filter((e) => !e.spells.includes(smite))
  const candidates = laners.length ? laners : enemies
  const seen = new Map<number, { total: number; inRole: number }>()
  for (const g of games)
    for (const p of g.participants) {
      const entry = seen.get(p.championId) ?? { total: 0, inRole: 0 }
      entry.total++
      if (p.teamPosition === role) entry.inRole++
      seen.set(p.championId, entry)
    }
  const scored = candidates
    .map((e) => {
      const s = seen.get(e.championId) ?? { total: 0, inRole: 0 }
      return { id: e.championId, inRole: s.inRole, share: s.inRole / (s.total || 1) }
    })
    .sort((a, b) => b.share - a.share || b.inRole - a.inRole)
  return { role, opponentId: scored[0]?.inRole ? scored[0].id : null }
}
