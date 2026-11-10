import type { ReviewPayload } from '../lib/review-timeline'

const snap = (gold: number, cs: number, health = 600) => ({
  x: 7400,
  y: 7400,
  gold,
  cs,
  jungleCs: 0,
  health,
})
const buy = (
  t: number,
  item: number,
  participant = 3,
  kind: 'purchased' | 'undone' | 'destroyed' = 'purchased',
) => ({
  t,
  participant,
  item,
  kind,
})

/// A reduced game seen from Twisted Fate mid (participant 3) against Ahri (8).
export function reviewPayload(): ReviewPayload {
  return {
    version: 1,
    matchId: 'EUW1_1',
    queueId: 420,
    gameVersion: '16.17.712.1234',
    gameCreation: Date.UTC(2026, 10, 9, 18),
    gameDuration: 1500,
    playerId: 3,
    participants: [
      ['Garen', 86, 'TOP'],
      ['Vi', 254, 'JUNGLE'],
      ['TwistedFate', 4, 'MIDDLE'],
      ['Jinx', 222, 'BOTTOM'],
      ['Lulu', 117, 'UTILITY'],
      ['Darius', 122, 'TOP'],
      ['LeeSin', 64, 'JUNGLE'],
      ['Ahri', 103, 'MIDDLE'],
      ['Syndra', 134, 'BOTTOM'],
      ['Nami', 267, 'UTILITY'],
    ].map(([championName, championId, position], index) => ({
      id: index + 1,
      championName: championName as string,
      championId: championId as number,
      position: position as string,
      teamId: index < 5 ? 100 : 200,
    })),
    frames: [
      { t: 0, snapshots: { 3: snap(500, 0), 8: snap(500, 0) } },
      { t: 60023, snapshots: { 3: snap(800, 4), 8: snap(780, 4) } },
      { t: 240000, snapshots: { 3: snap(1500, 20), 8: snap(1200, 14) } },
      { t: 420000, snapshots: { 3: snap(2600, 40), 8: snap(2000, 35) } },
      { t: 600000, snapshots: { 3: snap(4200, 70), 8: snap(3300, 62) } },
      { t: 1_500_000 - 21_000, snapshots: { 3: snap(9000, 200), 8: snap(8000, 180) } },
    ],
    kills: [
      { t: 180000, killer: 3, victim: 8, assists: [], x: 7400, y: 7400, turretDamage: 0 },
      { t: 340000, killer: 2, victim: 8, assists: [], x: 3000, y: 9000, turretDamage: 0 },
      { t: 600000, killer: 3, victim: 8, assists: [2], x: 7400, y: 7400, turretDamage: 0 },
      { t: 602000, killer: 2, victim: 7, assists: [3], x: 7450, y: 7380, turretDamage: 0 },
      { t: 604000, killer: 9, victim: 3, assists: [], x: 7420, y: 7500, turretDamage: 0 },
      { t: 900000, killer: 8, victim: 1, assists: [7], x: 12000, y: 3000, turretDamage: 0 },
      { t: 905000, killer: 6, victim: 4, assists: [10], x: 12100, y: 3100, turretDamage: 0 },
    ],
    items: [
      buy(10000, 1056),
      buy(10000, 2003),
      buy(10000, 2003),
      buy(10000, 1055, 8),
      buy(11000, 1001),
      buy(12000, 1001, 3, 'undone'),
      buy(100000, 2003, 3, 'destroyed'),
      buy(150000, 2003, 3, 'destroyed'),
      buy(360000, 3070),
      buy(361000, 2003),
      buy(362000, 2003),
      buy(895000, 1058),
    ],
    plates: [],
    buildings: [],
    monsters: [
      { t: 720000, killer: 2, team: 100, assists: [3], type: 'DRAGON', subType: 'FIRE_DRAGON' },
    ],
  }
}
