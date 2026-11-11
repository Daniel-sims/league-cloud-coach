import { expect, it } from 'vitest'
import {
  buildTimeline,
  clock,
  filterKinds,
  gameTimeMs,
  inventory,
  parseGameClock,
  region,
  videoOffset,
  type ReviewPayload,
} from './review-timeline'
import { reviewPayload } from '../test/review-fixture'

it('reads the in-game clock as typed and maps it onto the video', () => {
  expect(parseGameClock('12:34')).toBe(754)
  expect(parseGameClock(' 1:02:15 ')).toBe(3735)
  expect(parseGameClock('12:34.5')).toBe(754.5)
  expect(parseGameClock('90')).toBe(90)
  for (const bad of ['', '12:60', '1:60:00', '-1:00', 'ab', '1:2:3:4', '1.5:00'])
    expect(parseGameClock(bad)).toBeNull()
  const anchor = { gameTimeSeconds: 600, videoOffsetSeconds: 700 }
  expect(videoOffset(anchor, 0)).toBe(100)
  expect(gameTimeMs(anchor, 50_000)).toBe(0)
  expect(gameTimeMs(anchor, 701_000)).toBe(601_000)
  expect(clock(3_735_000)).toBe('1:02:15')
  expect(clock(754_900)).toBe('12:34')
})

it('names map regions from Riot coordinates', () => {
  expect(region({ x: 500, y: 500 })).toBe('Blue base')
  expect(region({ x: 9860, y: 4400 })).toBe('Dragon pit')
  expect(region({ x: 7400, y: 7400 })).toBe('Mid lane')
  expect(region({ x: 3000, y: 9000 })).toBe('Top-side jungle')
})

it('builds the native timeline: solo kills, teamfights with the player part, objectives and matchups', () => {
  const entries = buildTimeline(reviewPayload())
  const labels = entries.map((e) => `${clock(e.gameTimeMs)} ${e.kind} ${e.label}`)
  expect(labels).toEqual([
    '0:10 recall Opening buy',
    '1:00 matchup Lane matchup',
    '3:00 kill Killed Ahri',
    '4:00 matchup Lane matchup',
    '6:00 recall Recall',
    '7:00 matchup Lane matchup',
    '10:00 fight Teamfight',
    '10:00 matchup Lane matchup',
    '12:00 objective Infernal Drake taken by your team',
    '14:55 recall Recall',
  ])
  expect(entries.find((e) => e.kind === 'kill')!.detail).toBe('Solo kill')
  const fight = entries.find((e) => e.kind === 'fight')!
  expect(fight.fight).toMatchObject({
    outcome: 'won',
    enemyDeaths: 2,
    alliedDeaths: 1,
    location: 'Mid lane',
  })
  expect(fight.fight!.moments!.map((m) => m.label)).toEqual([
    'Killed Ahri',
    'Assisted killing LeeSin',
    'Died to Syndra',
  ])
  expect(filterKinds(fight)).toEqual(['fight', 'kill', 'death'])
  const recall = entries.find((e) => e.id === 'recall-360000')!
  expect(recall.detail).toBe('Backed 20 s after a takedown')
  expect(recall.items).toEqual([
    { item: 3070, count: 1 },
    { item: 2003, count: 2 },
  ])
  expect(recall.inventoryAfter).toEqual([
    { item: 1056, count: 1 },
    { item: 3070, count: 1 },
    { item: 2003, count: 2 },
  ])
  expect(entries.find((e) => e.id === 'matchup-240000')!.matchup).toMatchObject({
    player: { name: 'TwistedFate', gold: 1500, cs: 20, xp: 1100, level: 4, kda: [1, 0, 0] },
    opponent: { name: 'Ahri', gold: 1200, cs: 14, xp: 980, level: 3, kda: [0, 1, 0] },
  })
})

it('replays undone purchases and shows a dive callout on a standing turret', () => {
  const payload = reviewPayload()
  expect(inventory(payload, 3, 20_000)).toEqual([1056, 2003, 2003])
  const dive: ReviewPayload = {
    ...payload,
    kills: [
      { t: 300_000, killer: 3, victim: 8, assists: [2], x: 9000, y: 8400, turretDamage: 450 },
      { t: 302_000, killer: 8, victim: 2, assists: [], x: 9000, y: 8400, turretDamage: 0 },
    ],
    buildings: [
      { t: 320_000, team: 200, tower: 'OUTER_TURRET', lane: 'mid', x: 8955, y: 8510, killer: 3 },
    ],
  }
  const fight = buildTimeline(dive).find((e) => e.kind === 'fight')!
  expect(fight.fight!.turretCallout).toBe('Dive on the enemy mid T1 — tower fell after')
})

it('omits lane-opponent rows when the opponent is unknown', () => {
  const payload = reviewPayload()
  payload.participants = payload.participants.map((p) => ({ ...p, position: '' }))
  const kinds = new Set(buildTimeline(payload).map((e) => e.kind))
  expect(kinds.has('matchup')).toBe(false)
})
