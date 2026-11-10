import { expect, it } from 'vitest'
import {
  championGroups,
  emptyFilter,
  filterGames,
  gamesFor,
  seasonOf,
  splitOf,
  summary,
} from './league'

import { match } from '../test/league-fixture'
it('excludes remakes from every statistic while retaining their window slot and skips them for streaks', () => {
  const s = summary(
    gamesFor(
      [
        match('1', { gameEndedInEarlySurrender: true, kills: 50 }),
        match('2'),
        match('3', { win: false }),
      ],
      'me',
    ),
  )
  expect(s).toMatchObject({
    games: 2,
    wins: 1,
    losses: 1,
    remakes: 1,
    kills: 12,
    deaths: 4,
    assists: 8,
    streak: { win: true, count: 1 },
  })
  expect(s.winRate).toBe(0.5)
})
it('uses time-weighted primary-role farm and gold, and mean per-game team shares', () => {
  const s = summary(
    gamesFor(
      [
        match('1'),
        match('2'),
        match('3', {
          teamPosition: 'UTILITY',
          totalMinionsKilled: 0,
          neutralMinionsKilled: 0,
          goldEarned: 5000,
        }),
      ],
      'me',
    ),
  )
  expect(s.primaryRole).toBe('MIDDLE')
  expect(s.csPerMinute).toBe(10)
  expect(s.goldPerMinute).toBe(600)
  expect(s.killParticipation).toBe(0.5)
  expect(s.damageShare).toBe(0.25)
})
it('handles deathless games, missing roles and zero team denominators without fake ratios', () => {
  const g = match('1', {
    deaths: 0,
    teamPosition: '',
    kills: 0,
    assists: 0,
    totalDamageDealtToChampions: 0,
  })
  g.participants.forEach((p) => {
    p.kills = 0
    p.totalDamageDealtToChampions = 0
  })
  expect(summary(gamesFor([g], 'me'))).toMatchObject({
    deaths: 0,
    primaryRole: undefined,
    killParticipation: null,
    damageShare: null,
  })
  expect(summary([]).winRate).toBeNull()
})
it('matches the lane opponent instead of an unrelated enemy champion and falls back only without a position', () => {
  const g = match('1')
  g.participants.push({
    ...g.participants[2],
    puuid: 'enemy2',
    championId: 99,
    teamPosition: 'UTILITY',
  })
  expect(filterGames(gamesFor([g], 'me'), { ...emptyFilter, opponent: '99' })).toHaveLength(0)
  g.participants[0].teamPosition = ''
  expect(filterGames(gamesFor([g], 'me'), { ...emptyFilter, opponent: '99' })).toHaveLength(1)
})
it('keeps the full record when result narrows the history, and excludes remakes from wins and losses', () => {
  const games = gamesFor(
    [match('1'), match('2', { win: false }), match('3', { gameEndedInEarlySurrender: true })],
    'me',
  )
  const filter = { ...emptyFilter, result: 'win' }
  expect(filterGames(games, filter)).toHaveLength(1)
  expect(summary(filterGames(games, filter, false))).toMatchObject({
    wins: 1,
    losses: 1,
    remakes: 1,
  })
})
it('combines champion, queue, role, patch and sort filters', () => {
  const games = gamesFor([match('1'), match('2'), match('3', {}, { queueId: 450 })], 'me')
  expect(
    filterGames(games, {
      ...emptyFilter,
      champion: '103',
      queue: '420',
      role: 'MIDDLE',
      patch: '16.17',
      oldest: true,
    }).map((g) => g.id),
  ).toEqual(['2', '1'])
  expect(championGroups(games)[0].summary.games).toBe(3)
})
it('uses native patch-based seasons and split boundaries including unknown seasons', () => {
  expect(seasonOf(match('1', {}, { gameVersion: '16.9.123' }))).toBe(16)
  expect(splitOf(match('1', {}, { gameVersion: '16.8.123' }))).toBe(1)
  expect(splitOf(match('1', {}, { gameVersion: '16.9.123' }))).toBe(2)
  expect(splitOf(match('1', {}, { gameVersion: '16.15.123' }))).toBe(3)
  expect(splitOf(match('1', {}, { gameVersion: '17.1.123' }))).toBeNull()
})
it('keeps champion farm across roles while dashboard farm follows the primary role', () => {
  const games = gamesFor(
    [
      match('1'),
      match('2'),
      match('3', { teamPosition: 'UTILITY', totalMinionsKilled: 0, neutralMinionsKilled: 0 }),
    ],
    'me',
  )
  expect(summary(games).csPerMinute).toBe(10)
  expect(championGroups(games)[0].summary.csPerMinute).toBeCloseTo(400 / 60)
})
