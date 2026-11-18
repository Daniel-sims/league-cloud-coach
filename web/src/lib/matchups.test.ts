import { expect, it } from 'vitest'
import { gamesFor } from './league'
import {
  cleanDraft,
  emptyDraft,
  hasContent,
  headToHead,
  laneAt,
  laneCurve,
  matchupGames,
  pairings,
  searchChampions,
  type LaneFrame,
} from './matchups'
import { match } from '../test/league-fixture'

// Fixture games: you are Ahri (103) mid; the enemy mid is Zed (238).
const games = gamesFor(
  [
    match('EUW1_1'),
    match('EUW1_2', { win: false }),
    match('EUW1_3', { championId: 4, championName: 'TwistedFate' }),
    match('EUW1_4', {}, { gameDuration: 200 }),
  ],
  'me',
)
games[3].player.gameEndedInEarlySurrender = true

it('finds lane matchup games, optionally on one champion', () => {
  expect(matchupGames(games, 238, 103).map((g) => g.id)).toEqual(['EUW1_1', 'EUW1_2', 'EUW1_4'])
  expect(matchupGames(games, 238, null)).toHaveLength(4)
  expect(matchupGames(games, 222, null)).toHaveLength(0)
})

it('ignores games without a real lane opponent', () => {
  const aram = gamesFor([match('EUW1_9', { teamPosition: '' }, { queueId: 450 })], 'me')
  expect(matchupGames(aram, 238, null)).toHaveLength(0)
  expect(pairings(aram)).toHaveLength(0)
})

it('ranks champion/opponent pairs by decided games', () => {
  const pairs = pairings(games)
  expect(pairs.map((p) => [p.championId, p.opponentId, p.games.length, p.wins])).toEqual([
    [103, 238, 2, 1],
    [4, 238, 1, 1],
  ])
})

it('reads the difference nearest each minute and averages by result', () => {
  const lanes: Record<string, LaneFrame[]> = {
    EUW1_1: [
      [0, 0, 0, 0],
      [60, 100, 2, 30],
      [120, 300, 4, 60],
    ],
    EUW1_2: [
      [0, 0, 0, 0],
      [61, -200, -1, -40],
    ],
  }
  expect(laneAt(lanes.EUW1_1, 2, 'gold')).toBe(300)
  expect(laneAt(lanes.EUW1_2, 1, 'cs')).toBe(-1)
  expect(laneAt(lanes.EUW1_2, 2, 'gold')).toBeNull()
  expect(laneAt(undefined, 1, 'gold')).toBeNull()
  const curve = laneCurve(matchupGames(games, 238, 103), lanes, 'gold', 2)
  expect(curve[1]).toEqual({ minute: 1, all: -50, wins: 100, losses: -200, count: 2 })
  expect(curve[2]).toEqual({ minute: 2, all: 300, wins: 300, losses: null, count: 1 })
})

it('compares your averages with your lane opponent, skipping remakes', () => {
  const rows = headToHead(matchupGames(games, 238, 103))
  const deaths = rows.find((r) => r.key === 'deaths')!
  expect(deaths.lowerIsBetter).toBe(true)
  expect(deaths.you).toBe(2)
  expect(rows.find((r) => r.key === 'cs')!.you).toBeCloseTo(10)
})

it('searches champions by prefix, word and substring', () => {
  const options = [
    { id: 4, name: 'Twisted Fate' },
    { id: 517, name: 'Sylas' },
    { id: 238, name: 'Zed' },
    { id: 145, name: "Kai'Sa" },
    { id: 20, name: 'Nunu & Willump' },
  ]
  expect(searchChampions(options, 'syl').map((c) => c.id)).toEqual([517])
  expect(searchChampions(options, 'fate').map((c) => c.id)).toEqual([4])
  expect(searchChampions(options, 'kais').map((c) => c.id)).toEqual([145])
  expect(searchChampions(options, 'willump').map((c) => c.id)).toEqual([20])
  expect(searchChampions(options, '')).toHaveLength(5)
})

it('drops blank points and treats an empty note as no note', () => {
  expect(hasContent(emptyDraft)).toBe(false)
  expect(hasContent({ ...emptyDraft, threats: ['  '] })).toBe(false)
  expect(hasContent({ ...emptyDraft, difficulty: 'hard' })).toBe(true)
  expect(cleanDraft({ ...emptyDraft, tips: [' a ', ''], plan: ' go ' })).toMatchObject({
    tips: ['a'],
    plan: 'go',
  })
})
