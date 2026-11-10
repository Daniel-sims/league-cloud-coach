// Port of the native review timeline (Domain/Timeline/ReviewTimeline.swift and
// its detectors). Every judgement is made here, so it tests without a UI.
export type Lane = 'top' | 'mid' | 'bot'
export type Snapshot = {
  x: number
  y: number
  gold: number
  cs: number
  jungleCs: number
  health: number
  /** Absent from timelines stored before XP was recorded. */
  xp?: number
  level?: number
}
export type Kill = {
  t: number
  killer: number
  victim: number
  assists: number[]
  x: number
  y: number
  turretDamage: number
}
export type ItemEvent = {
  t: number
  participant: number
  item: number
  kind: 'purchased' | 'sold' | 'undone' | 'destroyed'
  restored?: number
}
export type ReviewPayload = {
  ultimates?: { detectorVersion: number; videoTimestampsMs: number[] }
  version: 1
  matchId: string
  queueId: number
  gameVersion: string
  gameCreation: number
  gameDuration: number
  playerId: number
  participants: {
    id: number
    championId: number
    championName: string
    teamId: number
    position: string
  }[]
  frames: { t: number; snapshots: Record<string, Snapshot> }[]
  kills: Kill[]
  items: ItemEvent[]
  plates: { t: number; team: number; lane: Lane; killer: number }[]
  buildings: {
    t: number
    team: number
    tower: string | null
    lane: Lane | null
    x: number
    y: number
    killer: number
  }[]
  monsters: {
    t: number
    killer: number
    team: number
    assists: number[]
    type: string
    subType: string | null
  }[]
}

export type EntryKind =
  | 'ultimate'
  | 'fight'
  | 'absentFight'
  | 'flag'
  | 'kill'
  | 'death'
  | 'recall'
  | 'matchup'
  | 'objective'
  | 'opponentItem'
export const entryKinds: { kind: EntryKind; name: string }[] = [
  { kind: 'flag', name: 'Flags' },
  { kind: 'ultimate', name: 'Ultimates' },
  { kind: 'kill', name: 'Kills' },
  { kind: 'death', name: 'Deaths' },
  { kind: 'fight', name: 'Fights' },
  { kind: 'absentFight', name: 'Fights without you' },
  { kind: 'recall', name: 'Recalls' },
  { kind: 'matchup', name: 'Lane matchups' },
  { kind: 'objective', name: 'Objectives' },
  { kind: 'opponentItem', name: 'Opponent items' },
]
export type ItemStack = { item: number; count: number }
export type FightParticipant = {
  id: number
  championId?: number
  championName: string
  kills: number
  assists: number
  died: boolean
  isPlayer: boolean
}
export type FightMoment = {
  t: number
  kind: 'kill' | 'assist' | 'death'
  label: string
  detail?: string
}
export type FightAbsence = {
  kind: 'dead' | 'shopping' | 'elsewhere' | 'lastSeen'
  label: string
  seekMs?: number
}
export type FightCard = {
  location: string
  allies: FightParticipant[]
  enemies: FightParticipant[]
  alliedDeaths: number
  enemyDeaths: number
  outcome: 'won' | 'lost' | 'traded'
  moments: FightMoment[] | null
  absence: FightAbsence | null
  turretCallout: string | null
}
export type MatchupSide = {
  name: string
  championId?: number
  kda: [number, number, number]
  gold: number
  cs: number
  xp?: number
  level?: number
}
export type MatchupCard = { player: MatchupSide; opponent: MatchupSide }
export type TimelineEntry = {
  id: string
  gameTimeMs: number
  kind: EntryKind
  label: string
  detail?: string
  sections?: { title: string; body: string }[]
  items?: ItemStack[]
  inventoryAfter?: ItemStack[]
  fight?: FightCard
  matchup?: MatchupCard
}

// MARK: - Clock anchor (Domain/Recording/GameClockAnchor.swift)

/// One observed correspondence between the game clock and the video. Both
/// advance at 1×, so one sample maps every game moment to a seek position.
export type ClockAnchor = { gameTimeSeconds: number; videoOffsetSeconds: number }
export const videoOffset = (a: ClockAnchor, gameSeconds: number) =>
  a.videoOffsetSeconds + (gameSeconds - a.gameTimeSeconds)
export const gameTime = (a: ClockAnchor, videoSeconds: number) =>
  a.gameTimeSeconds + (videoSeconds - a.videoOffsetSeconds)
/// The game clock at a video timestamp, clamped at zero: the loading screen
/// has no game time.
export const gameTimeMs = (a: ClockAnchor, videoMs: number) =>
  Math.max(0, Math.round(gameTime(a, videoMs / 1000) * 1000))

/// Reads a game clock as typed from the in-game timer: `12:34`, `1:02:15`,
/// `12:34.5` or bare seconds. Null for anything else.
export function parseGameClock(text: string): number | null {
  const parts = text.trim().split(':')
  if (parts.length < 1 || parts.length > 3) return null
  let seconds = 0
  for (const [index, raw] of parts.entries()) {
    const part = raw.trim()
    if (!/^\d+(\.\d+)?$/.test(part)) return null
    const value = Number(part)
    const last = index === parts.length - 1
    if (last) {
      if (parts.length > 1 && value >= 60) return null
    } else if (!Number.isInteger(value) || (index > 0 && value >= 60)) return null
    seconds = seconds * 60 + value
  }
  return Number.isFinite(seconds) ? seconds : null
}
export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

// MARK: - Map geometry (Domain/Timeline/MapGeometry.swift)

type Point = { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const blueFountain = { x: 420, y: 420 }
const redFountain = { x: 14170, y: 14450 }
const dragonPit = { x: 9860, y: 4400 }
const baronPit = { x: 5000, y: 10500 }
type Tier = 'outer' | 'inner' | 'inhibitor' | 'nexus'
type Turret = { teamId: number; lane: Lane | null; tier: Tier; x: number; y: number }
const tierNames: Record<Tier, string> = {
  outer: 'T1',
  inner: 'T2',
  inhibitor: 'T3',
  nexus: 'Nexus turret',
}
const towerTiers: Record<string, Tier> = {
  OUTER_TURRET: 'outer',
  INNER_TURRET: 'inner',
  BASE_TURRET: 'inhibitor',
  NEXUS_TURRET: 'nexus',
}
const turret = (teamId: number, lane: Lane | null, tier: Tier, x: number, y: number): Turret => ({
  teamId,
  lane,
  tier,
  x,
  y,
})
const turrets: Turret[] = [
  turret(100, 'top', 'outer', 981, 10441),
  turret(100, 'top', 'inner', 1512, 6699),
  turret(100, 'top', 'inhibitor', 1169, 4287),
  turret(100, 'mid', 'outer', 5846, 6396),
  turret(100, 'mid', 'inner', 5048, 4812),
  turret(100, 'mid', 'inhibitor', 3651, 3696),
  turret(100, 'bot', 'outer', 10504, 1029),
  turret(100, 'bot', 'inner', 6919, 1483),
  turret(100, 'bot', 'inhibitor', 4281, 1253),
  turret(100, null, 'nexus', 1748, 2270),
  turret(100, null, 'nexus', 2177, 1807),
  turret(200, 'top', 'outer', 4318, 13875),
  turret(200, 'top', 'inner', 7943, 13411),
  turret(200, 'top', 'inhibitor', 10481, 13650),
  turret(200, 'mid', 'outer', 8955, 8510),
  turret(200, 'mid', 'inner', 9767, 10113),
  turret(200, 'mid', 'inhibitor', 11134, 11207),
  turret(200, 'bot', 'outer', 13866, 4505),
  turret(200, 'bot', 'inner', 13327, 8226),
  turret(200, 'bot', 'inhibitor', 13624, 10572),
  turret(200, null, 'nexus', 13052, 12612),
  turret(200, null, 'nexus', 12611, 13084),
]
const p = (x: number, y: number) => ({ x, y })
const topLane = [
  blueFountain,
  p(1169, 4287),
  p(1512, 6699),
  p(981, 10441),
  p(1800, 13200),
  p(4318, 13875),
  p(7943, 13411),
  p(10481, 13650),
  redFountain,
]
const midLane = [
  blueFountain,
  p(3651, 3696),
  p(5048, 4812),
  p(5846, 6396),
  p(7500, 7500),
  p(8955, 8510),
  p(9767, 10113),
  p(11134, 11207),
  redFountain,
]
const botLane = [
  blueFountain,
  p(4281, 1253),
  p(6919, 1483),
  p(10504, 1029),
  p(13200, 1800),
  p(13866, 4505),
  p(13327, 8226),
  p(13624, 10572),
  redFountain,
]
const river = [p(2300, 12600), baronPit, p(7500, 7500), dragonPit, p(12600, 2300)]
function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const length = dx * dx + dy * dy
  if (!length) return distance(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}
const pathDistance = (point: Point, path: Point[]) =>
  Math.min(...path.slice(1).map((b, i) => segmentDistance(point, path[i], b)))

export function region(point: Point): string {
  if (distance(point, blueFountain) <= 2200) return 'Blue base'
  if (distance(point, redFountain) <= 2200) return 'Red base'
  if (distance(point, baronPit) <= 1300) return 'Baron pit'
  if (distance(point, dragonPit) <= 1300) return 'Dragon pit'
  const lanes = (
    [
      ['Top lane', topLane],
      ['Mid lane', midLane],
      ['Bot lane', botLane],
    ] as const
  )
    .map(([name, path]) => [name, pathDistance(point, [...path])] as const)
    .sort((a, b) => a[1] - b[1])
  if (lanes[0][1] <= 1050) return lanes[0][0]
  if (pathDistance(point, river) <= 1000) return point.y >= point.x ? 'Top river' : 'Bot river'
  return point.y >= point.x ? 'Top-side jungle' : 'Bot-side jungle'
}
function turretMatches(t: Turret, b: ReviewPayload['buildings'][number]) {
  if (b.team !== t.teamId || towerTiers[b.tower ?? ''] !== t.tier) return false
  return t.tier === 'nexus' ? distance(t, b) < 900 : b.lane === t.lane
}

// MARK: - Builder

const team = (id: number) => (id <= 5 ? 100 : 200)
const list = (names: string[]) =>
  new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(names)
export function stacks(items: number[]): ItemStack[] {
  const order: number[] = []
  const counts = new Map<number, number>()
  for (const item of items) {
    if (!counts.has(item)) order.push(item)
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return order.map((item) => ({ item, count: counts.get(item)! }))
}

type Context = {
  payload: ReviewPayload
  player: number
  opponent: number | null
  name(id: number): string
  championId(id: number): number | undefined
}
export function context(payload: ReviewPayload): Context {
  const byId = new Map(payload.participants.map((x) => [x.id, x]))
  const me = byId.get(payload.playerId)
  const opponent = payload.participants.find(
    (x) => me && x.teamId !== me.teamId && x.position && x.position === me.position,
  )
  return {
    payload,
    player: payload.playerId,
    opponent: opponent?.id ?? null,
    name: (id) => byId.get(id)?.championName ?? `Champion ${id}`,
    championId: (id) => byId.get(id)?.championId,
  }
}

export function buildTimeline(payload: ReviewPayload): TimelineEntry[] {
  const c = context(payload)
  const fights = clusters(payload.kills).filter(isTeamfight)
  const inFights = new Set(fights.flatMap((f) => f))
  return [
    ...killEntries(c, inFights),
    ...fights.map((f) => fightEntry(f, c)),
    ...flagEntries(c),
    ...recallEntries(c),
    ...matchupEntries(c),
    ...payload.monsters.map((m): TimelineEntry => ({
      id: `objective-${m.t}`,
      gameTimeMs: m.t,
      kind: 'objective',
      label: `${monsterName(m.type, m.subType)} taken by ${m.team === team(c.player) ? 'your team' : 'the enemy team'}`,
    })),
    ...opponentItemEntries(c),
  ].sort((a, b) => a.gameTimeMs - b.gameTimeMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/// The kinds a row answers to: a fight the player killed or died in also
/// answers to the kill and death filters.
export function filterKinds(entry: TimelineEntry): EntryKind[] {
  if (entry.kind !== 'fight' || !entry.fight?.moments) return [entry.kind]
  const kinds: EntryKind[] = ['fight']
  if (entry.fight.moments.some((m) => m.kind === 'kill')) kinds.push('kill')
  if (entry.fight.moments.some((m) => m.kind === 'death')) kinds.push('death')
  return kinds
}

function killMoment(kill: Kill, c: Context): FightMoment | null {
  if (kill.killer === c.player)
    return {
      t: kill.t,
      kind: 'kill',
      label: `Killed ${c.name(kill.victim)}`,
      detail: kill.assists.length ? `With ${list(kill.assists.map(c.name))}` : 'Solo kill',
    }
  if (kill.victim === c.player) {
    const killer = kill.killer > 0 ? c.name(kill.killer) : null
    return {
      t: kill.t,
      kind: 'death',
      label: killer ? `Died to ${killer}` : 'Executed',
      detail: kill.assists.length
        ? `${kill.assists.length + (killer ? 1 : 0)} champions involved`
        : undefined,
    }
  }
  if (kill.assists.includes(c.player))
    return {
      t: kill.t,
      kind: 'assist',
      label: `Assisted killing ${c.name(kill.victim)}`,
      detail: kill.killer > 0 ? `Kill by ${c.name(kill.killer)}` : undefined,
    }
  return null
}

function killEntries(c: Context, inFights: Set<Kill>): TimelineEntry[] {
  return c.payload.kills.flatMap((kill): TimelineEntry[] => {
    if (inFights.has(kill)) return []
    const moment = killMoment(kill, c)
    if (!moment || moment.kind === 'assist') return []
    return [
      {
        id: moment.kind === 'kill' ? `kill-${kill.t}-${kill.victim}` : `death-${kill.t}`,
        gameTimeMs: kill.t,
        kind: moment.kind,
        label: moment.label,
        detail: moment.detail,
      },
    ]
  })
}

// Fights: greedy clustering within 25 s and 3500 units of a cluster's last kill.
function clusters(kills: Kill[]): Kill[][] {
  const result: Kill[][] = []
  for (const kill of kills) {
    const home = result.find((cluster) => {
      const last = cluster[cluster.length - 1]
      return kill.t - last.t <= 25000 && distance(kill, last) <= 3500
    })
    if (home) home.push(kill)
    else result.push([kill])
  }
  return result
}
const involved = (kill: Kill) =>
  new Set([kill.victim, ...kill.assists, ...(kill.killer > 0 ? [kill.killer] : [])])
const fightParticipants = (fight: Kill[]) =>
  fight.reduce((all, kill) => new Set([...all, ...involved(kill)]), new Set<number>())
const isTeamfight = (fight: Kill[]) => fight.length >= 2 || fightParticipants(fight).size >= 4
const fightCenter = (fight: Kill[]) => ({
  x: Math.trunc(fight.reduce((s, k) => s + k.x, 0) / fight.length),
  y: Math.trunc(fight.reduce((s, k) => s + k.y, 0) / fight.length),
})

function fightEntry(fight: Kill[], c: Context): TimelineEntry {
  const card = fightCard(fight, c)
  const absent = card.moments === null
  return {
    id: `fight-${fight[0].t}`,
    gameTimeMs: fight[0].t,
    kind: absent ? 'absentFight' : 'fight',
    label: absent ? 'Teamfight without you' : 'Teamfight',
    fight: card,
  }
}

function fightCard(fight: Kill[], c: Context): FightCard {
  const mine = team(c.player)
  const ids = [...fightParticipants(fight)].sort((a, b) => a - b)
  const people = ids.map((id): FightParticipant => ({
    id,
    championId: c.championId(id),
    championName: c.name(id),
    kills: fight.filter((k) => k.killer === id).length,
    assists: fight.filter((k) => k.assists.includes(id)).length,
    died: fight.some((k) => k.victim === id),
    isPlayer: id === c.player,
  }))
  const alliedDeaths = fight.filter((k) => team(k.victim) === mine).length
  const enemyDeaths = fight.length - alliedDeaths
  const present = ids.includes(c.player)
  return {
    location: region(fightCenter(fight)),
    allies: people.filter((x) => team(x.id) === mine),
    enemies: people.filter((x) => team(x.id) !== mine),
    alliedDeaths,
    enemyDeaths,
    outcome: enemyDeaths > alliedDeaths ? 'won' : alliedDeaths > enemyDeaths ? 'lost' : 'traded',
    moments: present ? fight.flatMap((k) => killMoment(k, c) ?? []) : null,
    absence: present ? null : absence(fight, c),
    turretCallout: turretCallout(fight, c),
  }
}

const laneNames: Record<Lane, string> = { top: 'top', mid: 'mid', bot: 'bot' }
function absence(fight: Kill[], c: Context): FightAbsence | null {
  const { payload, player } = c
  const start = fight[0].t,
    end = fight[fight.length - 1].t
  // A frame inside the fight's span is the one moment a minute-stale frame is ground truth.
  const frame = payload.frames.find((f) => f.t >= start && f.t <= end)
  const snapshot = frame?.snapshots[player]
  const lastDeath = payload.kills.filter((k) => k.victim === player && k.t < start).at(-1)
  const deathLabel = (certain: boolean) => {
    if (!lastDeath) return 'You were dead'
    const seconds = Math.trunc((start - lastDeath.t) / 1000)
    const died = lastDeath.killer > 0 ? `died to ${c.name(lastDeath.killer)}` : 'died'
    return certain
      ? `You were dead — ${died} ${seconds} s earlier`
      : `You ${died} ${seconds} s before this fight`
  }
  if (snapshot && snapshot.health === 0)
    return { kind: 'dead', label: deathLabel(true), seekMs: lastDeath?.t }
  if (lastDeath && start - lastDeath.t <= 45000)
    return { kind: 'dead', label: deathLabel(false), seekMs: lastDeath.t }
  const purchase = payload.items.find(
    (i) => i.participant === player && i.kind !== 'destroyed' && i.t >= start - 10000 && i.t <= end,
  )
  if (purchase) return { kind: 'shopping', label: 'You were shopping at base', seekMs: purchase.t }

  const within = (t: number) => t >= start - 10000 && t <= end + 10000
  const kill = payload.kills.find((k) => within(k.t) && involved(k).has(player))
  if (kill) {
    const where = region(kill).toLowerCase()
    return {
      kind: 'elsewhere',
      label:
        kill.victim === player
          ? `You died in the ${where} during this fight`
          : `You were fighting in the ${where}`,
      seekMs: kill.t,
    }
  }
  const monster = payload.monsters.find(
    (m) => within(m.t) && (m.killer === player || m.assists.includes(player)),
  )
  if (monster)
    return {
      kind: 'elsewhere',
      label: `You were taking ${monsterName(monster.type, monster.subType)}`,
      seekMs: monster.t,
    }
  const building = payload.buildings.find((b) => within(b.t) && b.killer === player)
  if (building)
    return {
      kind: 'elsewhere',
      label: `You were taking a tower ${building.lane ? `in the ${laneNames[building.lane]} lane` : 'elsewhere'}`,
      seekMs: building.t,
    }
  const plate = payload.plates.find((x) => within(x.t) && x.killer === player)
  if (plate)
    return {
      kind: 'elsewhere',
      label: `You were pushing the ${laneNames[plate.lane]} lane`,
      seekMs: plate.t,
    }
  if (frame && snapshot)
    return {
      kind: 'lastSeen',
      label: `Mid-fight you were near the ${region(snapshot).toLowerCase()}`,
      seekMs: frame.t,
    }
  return null
}

function turretCallout(fight: Kill[], c: Context): string | null {
  const center = fightCenter(fight)
  const nearest = turrets.map((t) => ({ t, d: distance(t, center) })).sort((a, b) => a.d - b.d)[0]
  if (!nearest || nearest.d > 1800) return null
  const t = nearest.t
  const start = fight[0].t,
    end = fight[fight.length - 1].t
  const falls = c.payload.buildings.filter((b) => turretMatches(t, b))
  const latest = Math.max(-Infinity, ...falls.filter((b) => b.t <= start).map((b) => b.t))
  // Nexus turrets respawn after three minutes; lane turrets stay down.
  const alive = latest === -Infinity || (t.tier === 'nexus' && start - latest >= 180000)
  if (!alive) return null
  const turretDamage = fight.reduce((sum, k) => sum + k.turretDamage, 0)
  const defenderDied = fight.some(
    (k) =>
      k.killer > 0 &&
      team(k.victim) === t.teamId &&
      team(k.killer) !== t.teamId &&
      distance(k, t) <= 1100,
  )
  const owner = t.teamId === team(c.player) ? 'your' : 'the enemy'
  const name = t.lane
    ? `${owner} ${laneNames[t.lane]} ${tierNames[t.tier]}`
    : `${owner} Nexus turret`
  const base =
    turretDamage > 0 ? `Dive on ${name}` : defenderDied ? `Possibly a dive on ${name}` : null
  if (!base) return null
  const fell = falls.some((b) => b.t >= end && b.t <= end + 30000)
  return fell ? `${base} — tower fell after` : base
}

function flagEntries(c: Context): TimelineEntry[] {
  if (c.opponent === null) return []
  return clusters(c.payload.kills).flatMap((fight): TimelineEntry[] => {
    const people = fightParticipants(fight)
    if (!isTeamfight(fight) || fight[0].t < 300000 || people.size < 4) return []
    if (!people.has(c.opponent!) || people.has(c.player)) return []
    return [
      {
        id: `flag-${fight[0].t}`,
        gameTimeMs: fight[0].t,
        kind: 'flag',
        label: 'Teamfight without you — worth a rewatch',
        sections: [
          {
            title: 'Why flagged',
            body: "Your lane opponent took part in this fight; you earned no kill, assist, or death in it. The data can't say why — a prompt, not a verdict.",
          },
        ],
      },
    ]
  })
}

// Shop visits: shop transactions within 30 s of each other.
type Visit = {
  start: number
  end: number
  bought: number[]
  kind: 'openingBuy' | 'deathBuy' | 'recall'
}
function visits(c: Context, participant: number): Visit[] {
  const events = c.payload.items.filter(
    (i) => i.participant === participant && i.kind !== 'destroyed',
  )
  const groups: ItemEvent[][] = []
  for (const event of events) {
    const current = groups.at(-1)
    if (current && event.t - current[current.length - 1].t <= 30000) current.push(event)
    else groups.push([event])
  }
  const deaths = c.payload.kills.filter((k) => k.victim === participant)
  return groups.map((group) => {
    const start = group[0].t
    const bought: number[] = []
    for (const event of group) {
      if (event.kind === 'purchased') bought.push(event.item)
      else if (event.kind === 'undone') {
        const index = bought.lastIndexOf(event.item)
        if (index >= 0) bought.splice(index, 1)
      }
    }
    const kind =
      start < 90000
        ? 'openingBuy'
        : deaths.some((d) => start - d.t >= 0 && start - d.t < 30000)
          ? 'deathBuy'
          : 'recall'
    return { start, end: group[group.length - 1].t, bought, kind }
  })
}
/// Replays the item stream: purchases add, sells and destroys remove, undos revert.
export function inventory(
  payload: ReviewPayload,
  participant: number,
  at: number,
  inclusive = false,
) {
  const held: number[] = []
  for (const event of payload.items) {
    if (event.participant !== participant || !(event.t < at || (inclusive && event.t === at)))
      continue
    if (event.kind === 'purchased') held.push(event.item)
    else if (event.kind === 'undone') {
      const index = held.lastIndexOf(event.item)
      if (index >= 0) held.splice(index, 1)
      if (event.restored) held.push(event.restored)
    } else {
      const index = held.indexOf(event.item)
      if (index >= 0) held.splice(index, 1)
    }
  }
  return held
}
function recallEntries(c: Context): TimelineEntry[] {
  return visits(c, c.player).map((visit) => {
    const notes: string[] = []
    if (visit.kind === 'recall') {
      const takedown = c.payload.kills
        .filter(
          (k) =>
            k.t >= visit.start - 30000 &&
            k.t < visit.start &&
            ((involved(k).has(c.player) && k.victim !== c.player) || k.victim === c.opponent),
        )
        .map((k) => k.t)
      if (takedown.length)
        notes.push(
          `backed ${Math.trunc((visit.start - Math.max(...takedown)) / 1000)} s after a takedown`,
        )
      if (
        c.opponent !== null &&
        c.payload.items.some(
          (i) =>
            i.participant === c.opponent &&
            i.kind !== 'destroyed' &&
            i.t >= visit.start - 25000 &&
            i.t <= visit.end + 25000,
        )
      )
        notes.push('opponent backed too')
    }
    const detail = notes.join(' · ')
    return {
      id: `recall-${visit.start}`,
      gameTimeMs: visit.start,
      kind: 'recall',
      label:
        visit.kind === 'openingBuy'
          ? 'Opening buy'
          : visit.kind === 'deathBuy'
            ? 'Shopped after dying'
            : visit.bought.length
              ? 'Recall'
              : 'Recall — bought nothing',
      detail: detail ? detail[0].toUpperCase() + detail.slice(1) : undefined,
      items: stacks(visit.bought),
      inventoryAfter:
        visit.kind === 'openingBuy'
          ? undefined
          : stacks(inventory(c.payload, c.player, visit.end, true)),
    }
  })
}

function matchupEntries(c: Context): TimelineEntry[] {
  const opponent = c.opponent
  if (opponent === null) return []
  const score = (id: number, t: number): [number, number, number] => {
    const kills = c.payload.kills.filter((k) => k.t <= t)
    return [
      kills.filter((k) => k.killer === id).length,
      kills.filter((k) => k.victim === id).length,
      kills.filter((k) => k.assists.includes(id)).length,
    ]
  }
  const side = (id: number, s: Snapshot, t: number): MatchupSide => ({
    name: c.name(id),
    championId: c.championId(id),
    kda: score(id, t),
    gold: s.gold,
    cs: s.cs + s.jungleCs,
    xp: s.xp,
    level: s.level,
  })
  return c.payload.frames.flatMap((frame): TimelineEntry[] => {
    const me = frame.snapshots[c.player],
      them = frame.snapshots[opponent]
    // Riot stamps minute frames a few milliseconds late (60023, 120047…); the
    // final frame at the game's end is partial and not a checkpoint.
    const minute = Math.round(frame.t / 60000) * 60000
    if (minute <= 0 || Math.abs(frame.t - minute) > 5000 || !me || !them) return []
    return [
      {
        id: `matchup-${frame.t}`,
        gameTimeMs: frame.t,
        kind: 'matchup',
        label: 'Lane matchup',
        matchup: {
          player: side(c.player, me, frame.t),
          opponent: side(opponent, them, frame.t),
        },
      },
    ]
  })
}

function opponentItemEntries(c: Context): TimelineEntry[] {
  const opponent = c.opponent
  if (opponent === null) return []
  return visits(c, opponent)
    .filter((v) => v.bought.length)
    .map((v) => ({
      id: `opponentItem-${v.start}`,
      gameTimeMs: v.start,
      kind: 'opponentItem' as const,
      label: `${c.name(opponent)} bought ${v.bought.length} ${v.bought.length === 1 ? 'item' : 'items'}`,
      items: stacks(v.bought),
    }))
}

export function monsterName(type: string, subType: string | null) {
  if (type === 'DRAGON')
    return (
      {
        AIR_DRAGON: 'Cloud Drake',
        EARTH_DRAGON: 'Mountain Drake',
        FIRE_DRAGON: 'Infernal Drake',
        WATER_DRAGON: 'Ocean Drake',
        HEXTECH_DRAGON: 'Hextech Drake',
        CHEMTECH_DRAGON: 'Chemtech Drake',
        ELDER_DRAGON: 'Elder Dragon',
      }[subType ?? ''] ?? 'Dragon'
    )
  return (
    {
      RIFTHERALD: 'Rift Herald',
      BARON_NASHOR: 'Baron Nashor',
      HORDE: 'Void Grubs',
      ATAKHAN: 'Atakhan',
    }[type] ??
    type
      .toLowerCase()
      .split('_')
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ')
  )
}

/** Casts stay on the video clock; resyncing moves them against game events. */
export function ultimateEntries(
  payload: ReviewPayload,
  anchor: ClockAnchor | null,
): TimelineEntry[] {
  if (!anchor || !payload.ultimates) return []
  return [...new Set(payload.ultimates.videoTimestampsMs)]
    .filter((ms) => Number.isSafeInteger(ms) && ms >= 0 && gameTime(anchor, ms / 1000) > 0)
    .map((ms): TimelineEntry => ({
      id: `ultimate-${ms}`,
      gameTimeMs: gameTimeMs(anchor, ms),
      kind: 'ultimate',
      label: 'Cast ultimate',
    }))
}
