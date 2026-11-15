import type { ReviewPayload } from './review-timeline'

// Reconstructs every player's items at any moment from Riot's item log.
//
// The log records purchases, sales, undos and "destroyed" items, but several
// changes are never logged as a purchase. Each rule below was checked against
// 925 real games (9,250 inventories) by replaying to the end and comparing
// with the match summary's final items; see docs/PROJECT_STATE.md.

/** Lane quest, quest reward and recall pseudo-items: never real inventory. */
const pseudo = new Set([
  1090, 1091, 1092, 1093, 1094, 1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210,
  1211, 1220, 1221, 1222, 2001, 2002, 2007, 772001,
])
const botLaneQuest = 1202
const questCompletions = new Set([1200, 1201, 1202, 1203, 1204, 1222])
/** Tier-2 boots and the tier-3 boots they silently become. */
const tier3Boots = new Map([
  [3006, 3172],
  [3008, 3168],
  [3009, 3170],
  [3010, 3013],
  [3020, 3175],
  [3047, 3174],
  [3111, 3173],
  [3158, 3171],
])
const boots = new Set([1001, 2422, ...tier3Boots.keys(), ...tier3Boots.values()])
/** Items that change into another without a purchase: a lone destroy marks the moment. */
const transforms = new Map([
  [3004, 3042], // Manamune → Muramana
  [3003, 3040], // Archangel's Staff → Seraph's Embrace
  [3119, 3121], // Winter's Approach → Fimbulwinter
  [2420, 2421], // Seeker's Armguard → Shattered Armguard
  [2526, 2530], // Whispering Circlet → Diadem of Songs
  [3865, 3866], // World Atlas → Runic Compass
  [3866, 3867], // Runic Compass → Bounty of Worlds
])
const bountyOfWorlds = 3867
/** Bounty of Worlds' upgrades; which one a support picked is only in the final items. */
const supportFinals = new Set([3869, 3870, 3871, 3876, 3877])
/** Given without a purchase at the start of the game. */
const freeStart = new Set([3340, 3865])
/** Magical Footwear's free boots; they arrive at 12:00 (sooner with takedowns). */
const magicalFootwear = 2422
const junglePets = new Set([1101, 1102, 1103, 1105, 1106, 1107])
const viego = 234
export const trinkets = new Set([3330, 3340, 3363, 3364, 3513])
/** Used up or drunk: never meaningful to check against the final items. */
const consumables = new Set([2003, 2031, 2033, 2055, 2138, 2139, 2140, 2150, 2151, 2152])

const order = { purchased: 0, undone: 1, sold: 2, destroyed: 3 } as const

/** One item held from `from` until `to` (exclusive), in game milliseconds; `seq` keeps arrival order. */
export type ItemSpan = { item: number; from: number; to: number; seq: number }

export type PlayerItems = {
  spans: ItemSpan[]
  /**
   * Whether the replay ends with exactly the final items Riot reports. Null
   * when the review has no final items to check against (older reviews).
   */
  verified: boolean | null
}

export function replayItems(payload: ReviewPayload, participant: number): PlayerItems {
  const champion = payload.participants.find((p) => p.id === participant)
  const finals = champion?.finalItems
  const events = payload.items
    .filter((e) => e.participant === participant)
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind] || a.i - b.i)
  const purchases = events.filter((e) => e.kind === 'purchased')
  // Destroying components while buying the item they build into is not a transform.
  const lone = (t: number, item: number) =>
    !purchases.some((p) => Math.abs(p.t - t) <= 1000 && p.item !== item)
  const quest = events.find((e) => e.kind === 'destroyed' && questCompletions.has(e.item))

  const held: { item: number; from: number; seq: number }[] = []
  const spans: ItemSpan[] = []
  let seq = 0
  const add = (item: number, t: number) => held.push({ item, from: t, seq: seq++ })
  const drop = (item: number, t: number, last = false) => {
    const matches = held.flatMap((h, i) => (h.item === item ? [i] : []))
    const index = matches.length ? matches[last ? matches.length - 1 : 0] : -1
    if (index < 0) return false
    spans.push({ item, from: held[index].from, to: t, seq: held[index].seq })
    held.splice(index, 1)
    return true
  }
  let bounty: number | null = null

  for (const e of events) {
    if (pseudo.has(e.item) || (e.restored && pseudo.has(e.restored))) continue
    if (e.kind === 'purchased') add(e.item, e.t)
    else if (e.kind === 'undone') {
      if (e.item > 0) drop(e.item, e.t, true)
      if (e.restored) add(e.restored, e.t)
    } else if (e.kind === 'sold') drop(e.item, e.t)
    else {
      // The Bot Lane Quest moves boots to their own slot; they're still worn.
      if (quest?.item === botLaneQuest && e.t === quest.t && boots.has(e.item)) continue
      // Viego's possessions log the inventories swapping without real changes.
      if (champion?.championId === viego && lone(e.t, e.item) && !junglePets.has(e.item)) continue
      const upgrade = tier3Boots.get(e.item)
      if (upgrade && held.some((h) => h.item === e.item)) {
        // Tier-2 boots are only ever destroyed by turning into tier 3 (selling is its own event).
        drop(e.item, e.t)
        add(upgrade, e.t)
        continue
      }
      const wasHeld = drop(e.item, e.t)
      if (!wasHeld && freeStart.has(e.item)) spans.push({ item: e.item, from: 0, to: e.t, seq: -1 })
      if (!wasHeld && e.item === magicalFootwear)
        spans.push({ item: e.item, from: Math.min(720_000, e.t), to: e.t, seq: -1 })
      const next = transforms.get(e.item)
      if (next && (wasHeld || freeStart.has(e.item) || e.item === 3866) && lone(e.t, e.item))
        add(next, e.t)
      else if (e.item === bountyOfWorlds) bounty = e.t
    }
  }

  if (finals) {
    const holding = new Set(held.map((h) => h.item))
    for (const item of finals) {
      if (holding.has(item)) continue
      if (supportFinals.has(item) && bounty !== null) add(item, bounty)
      else if (freeStart.has(item)) add(item, 0)
      else if (item === magicalFootwear) add(item, Math.min(720_000, payload.gameDuration * 1000))
    }
  }
  for (const h of held) spans.push({ ...h, to: Infinity })
  spans.sort((a, b) => a.from - b.from || a.seq - b.seq)

  let verified: boolean | null = null
  if (finals) {
    const skip = (item: number) =>
      consumables.has(item) ||
      trinkets.has(item) ||
      (quest?.item === botLaneQuest && boots.has(item))
    const want = new Set(finals.filter((i) => i && !skip(i)))
    const got = new Set(held.map((h) => h.item).filter((i) => !skip(i)))
    verified = want.size === got.size && [...want].every((i) => got.has(i))
  }
  return { spans, verified }
}

/** Items held at `at` (game ms), in the order they arrived; trinket last. */
export function itemsAt(replay: PlayerItems, at: number) {
  const now = replay.spans.filter((s) => s.from <= at && at < s.to).map((s) => s.item)
  return [...now.filter((i) => !trinkets.has(i)), ...now.filter((i) => trinkets.has(i))]
}

export type BoardPlayer = {
  id: number
  championId: number
  championName: string
  teamId: number
  position: string
  kills: number
  deaths: number
  assists: number
  level: number | null
  cs: number | null
  gold: number | null
  items: number[]
  verified: boolean | null
}

export type BoardTeam = {
  teamId: number
  players: BoardPlayer[]
  kills: number
  gold: number | null
  towers: number
  dragons: number
  barons: number
  heralds: number
  grubs: number
}

export type Board = {
  at: number
  /** Time of the per-minute snapshot behind level, CS and gold. */
  snapshotAt: number | null
  teams: BoardTeam[]
}

const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

/** Everything the scoreboard shows at game time `at`. Replays are computed once per payload. */
export function boardAt(
  payload: ReviewPayload,
  replays: Map<number, PlayerItems>,
  at: number,
): Board {
  const frame = payload.frames.filter((f) => f.t <= at).at(-1) ?? null
  const kills = payload.kills.filter((k) => k.t <= at)
  const players = payload.participants.map((p): BoardPlayer => {
    const snap = frame?.snapshots[String(p.id)]
    return {
      id: p.id,
      championId: p.championId,
      championName: p.championName,
      teamId: p.teamId,
      position: p.position,
      kills: kills.filter((k) => k.killer === p.id).length,
      deaths: kills.filter((k) => k.victim === p.id).length,
      assists: kills.filter((k) => k.assists.includes(p.id)).length,
      level: snap?.level ?? null,
      cs: snap ? snap.cs + snap.jungleCs : null,
      gold: snap ? snap.gold : null,
      items: replays.get(p.id) ? itemsAt(replays.get(p.id)!, at) : [],
      verified: replays.get(p.id)?.verified ?? null,
    }
  })
  const monsters = payload.monsters.filter((m) => m.t <= at)
  const teams = [100, 200].map((teamId): BoardTeam => {
    const own = players
      .filter((p) => p.teamId === teamId)
      .sort((a, b) => {
        const ra = roles.indexOf(a.position),
          rb = roles.indexOf(b.position)
        return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || a.id - b.id
      })
    const taken = monsters.filter((m) => m.team === teamId)
    return {
      teamId,
      players: own,
      kills: own.reduce((n, p) => n + p.kills, 0),
      gold: own.every((p) => p.gold !== null) ? own.reduce((n, p) => n + p.gold!, 0) : null,
      // A building's team is the side that lost it.
      towers: payload.buildings.filter((b) => b.t <= at && b.team !== teamId && b.tower !== null)
        .length,
      dragons: taken.filter((m) => m.type === 'DRAGON').length,
      barons: taken.filter((m) => m.type === 'BARON_NASHOR').length,
      heralds: taken.filter((m) => m.type === 'RIFTHERALD').length,
      grubs: taken.filter((m) => m.type === 'HORDE').length,
    }
  })
  return { at, snapshotAt: frame?.t ?? null, teams }
}

export function replayAll(payload: ReviewPayload) {
  return new Map(payload.participants.map((p) => [p.id, replayItems(payload, p.id)]))
}
