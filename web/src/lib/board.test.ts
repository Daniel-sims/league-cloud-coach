import { expect, it } from 'vitest'
import { boardAt, itemsAt, replayAll, replayItems } from './board'
import type { ItemEvent, ReviewPayload } from './review-timeline'

const at = (m: number, s = 0) => (m * 60 + s) * 1000
const buy = (t: number, item: number, participant = 1): ItemEvent => ({
  t,
  participant,
  item,
  kind: 'purchased',
})
const gone = (t: number, item: number, participant = 1): ItemEvent => ({
  t,
  participant,
  item,
  kind: 'destroyed',
})
function payload(
  items: ItemEvent[],
  finalItems?: number[],
  patch: Partial<ReviewPayload> = {},
): ReviewPayload {
  return {
    version: 1,
    matchId: 'EUW1_1',
    queueId: 420,
    gameVersion: '16.22.1',
    gameCreation: 0,
    gameDuration: 1800,
    playerId: 1,
    participants: [
      {
        id: 1,
        championId: 4,
        championName: 'TwistedFate',
        teamId: 100,
        position: 'MIDDLE',
        ...(finalItems ? { finalItems } : {}),
      },
      { id: 6, championId: 103, championName: 'Ahri', teamId: 200, position: 'MIDDLE' },
    ],
    frames: [],
    kills: [],
    items,
    plates: [],
    buildings: [],
    monsters: [],
    ...patch,
  }
}

it('replays purchases, component use, sales and undos', () => {
  const p = payload([
    buy(at(0, 10), 1056),
    buy(at(0, 10), 2003),
    buy(at(0, 10), 2003),
    gone(at(2), 2003),
    buy(at(5), 1052),
    { t: at(5, 2), participant: 1, item: 1052, kind: 'undone' },
    buy(at(6), 1052),
    buy(at(8), 3108),
    gone(at(8), 1052),
    { t: at(9), participant: 1, item: 1056, kind: 'sold' },
    { t: at(9, 1), participant: 1, item: 0, kind: 'undone', restored: 1056 },
  ])
  const r = replayItems(p, 1)
  expect(itemsAt(r, at(1))).toEqual([1056, 2003, 2003])
  expect(itemsAt(r, at(5, 1))).toEqual([1056, 2003, 1052])
  expect(itemsAt(r, at(7))).toEqual([1056, 2003, 1052])
  expect(itemsAt(r, at(8, 30))).toEqual([1056, 2003, 3108])
  expect(itemsAt(r, at(10))).toEqual([2003, 3108, 1056])
  expect(r.verified).toBeNull()
})

it('upgrades boots, transforms tear items and names the support upgrade from the final items', () => {
  const p = payload(
    [
      buy(at(3), 1001),
      buy(at(6), 3020),
      gone(at(6), 1001),
      gone(at(12), 1201), // Mid Lane Quest
      gone(at(12), 3020), // Sorcerer's Shoes → Spellslinger's Shoes
      buy(at(10), 3004),
      gone(at(20), 3004), // Manamune → Muramana, no purchase alongside
      gone(at(7), 3865), // free World Atlas → Runic Compass
      gone(at(13), 3866), // → Bounty of Worlds
      gone(at(13, 1), 3867), // → the upgrade the player picked
      gone(at(14), 2001), // Recall pseudo-item
    ],
    [3175, 3042, 3870, 0, 0, 0, 3340],
  )
  const r = replayItems(p, 1)
  expect(itemsAt(r, at(1))).toEqual([3865, 3340])
  expect(itemsAt(r, at(8))).toEqual([3020, 3866, 3340])
  expect(itemsAt(r, at(12, 30))).toEqual([3866, 3004, 3175, 3340])
  expect(itemsAt(r, at(13, 30))).toEqual([3004, 3175, 3870, 3340])
  expect(itemsAt(r, at(25))).toEqual([3175, 3870, 3042, 3340])
  expect(r.verified).toBe(true)
})

it('keeps a component destroyed while building an item and flags an unexplained final inventory', () => {
  const p = payload([buy(at(5), 3004), buy(at(20), 3042), gone(at(20), 3004)], [3042, 6672])
  const r = replayItems(p, 1)
  expect(itemsAt(r, at(25))).toEqual([3042])
  expect(r.verified).toBe(false)
})

it('keeps ADC boots worn after the Bot Lane Quest moves them out of the reported slots', () => {
  const p = payload([buy(at(5), 1001), gone(at(13), 1202), gone(at(13), 1001)], [6672])
  const r = replayItems(p, 1)
  expect(itemsAt(r, at(14))).toEqual([1001])
})

it('ignores the inventory swaps logged while Viego possesses a champion', () => {
  const p = payload([buy(at(5), 6672), gone(at(16), 6672), gone(at(16), 3078)])
  p.participants[0].championId = 234
  expect(itemsAt(replayItems(p, 1), at(17))).toEqual([6672])
})

it('builds the board at a moment: score, objectives and the last snapshot', () => {
  const snap = { x: 0, y: 0, gold: 0, cs: 0, jungleCs: 0, health: 1, xp: 0, level: 1 }
  const p = payload([buy(at(0, 10), 1056)], undefined, {
    frames: [
      { t: 0, snapshots: { '1': snap, '6': snap } },
      {
        t: at(10),
        snapshots: {
          '1': { ...snap, gold: 4200, cs: 80, jungleCs: 4, level: 9 },
          '6': { ...snap, gold: 3900, level: 8 },
        },
      },
    ],
    kills: [
      { t: at(8), killer: 1, victim: 6, assists: [], x: 0, y: 0, turretDamage: 0 },
      { t: at(12), killer: 6, victim: 1, assists: [], x: 0, y: 0, turretDamage: 0 },
    ],
    monsters: [
      { t: at(9), killer: 1, team: 100, assists: [], type: 'DRAGON', subType: 'FIRE_DRAGON' },
    ],
    buildings: [
      { t: at(11), team: 200, tower: 'OUTER_TURRET', lane: 'mid', x: 0, y: 0, killer: 1 },
    ],
  })
  const board = boardAt(p, replayAll(p), at(11, 30))
  expect(board.snapshotAt).toBe(at(10))
  const [blue, red] = board.teams
  expect(blue).toMatchObject({ kills: 1, gold: 4200, towers: 1, dragons: 1 })
  expect(red).toMatchObject({ kills: 0, towers: 0, dragons: 0 })
  expect(blue.players[0]).toMatchObject({ kills: 1, deaths: 0, level: 9, cs: 84, items: [1056] })
  expect(red.players[0]).toMatchObject({ deaths: 1 })
})
