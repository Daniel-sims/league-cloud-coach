import { afterEach, expect, it } from 'vitest'
import { loadViewed, saveViewed } from './viewed-cache'
import { match } from '../test/league-fixture'
import type { LeagueProfile } from './league'

const profile = (puuid: string): LeagueProfile => ({
  id: 'viewing',
  platform: 'euw1',
  puuid,
  gameName: puuid,
  tagLine: 'EUW',
  profileIconId: 1,
  summonerLevel: 5,
  ranks: [],
  syncedAt: null,
})
afterEach(() => localStorage.clear())
it('round-trips a looked-up player per owner and region', () => {
  saveViewed('o', 'euw1', 'a', { profile: profile('a'), matches: [match('1')] })
  expect(loadViewed('o', 'euw1', 'a')?.matches).toHaveLength(1)
  expect(loadViewed('other', 'euw1', 'a')).toBeNull()
  expect(loadViewed('o', 'na1', 'a')).toBeNull()
})
it('keeps only the most recent players and survives unreadable storage', () => {
  for (const id of 'abcdefgh') saveViewed('o', 'euw1', id, { profile: profile(id), matches: [] })
  expect(loadViewed('o', 'euw1', 'a')).toBeNull()
  expect(loadViewed('o', 'euw1', 'h')).not.toBeNull()
  localStorage.setItem('league-viewed:o:euw1:z', '{broken')
  expect(loadViewed('o', 'euw1', 'z')).toBeNull()
})
