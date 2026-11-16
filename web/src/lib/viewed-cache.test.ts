import { afterEach, expect, it } from 'vitest'
import { listViewed, loadViewed, resetViewedMigration, saveViewed } from './viewed-cache'
import { clearMatchCache } from './match-cache'
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
afterEach(() => {
  localStorage.clear()
  clearMatchCache()
  resetViewedMigration()
})
it('round-trips a looked-up player per owner and region', async () => {
  await saveViewed('o', 'euw1', 'a', { profile: profile('a'), matches: [match('1')] })
  expect((await loadViewed('o', 'euw1', 'a'))?.matches).toHaveLength(1)
  expect(await loadViewed('other', 'euw1', 'a')).toBeNull()
  expect(await loadViewed('o', 'na1', 'a')).toBeNull()
})
it('keeps only the most recent players, newest first', async () => {
  for (const id of 'abcdefgh')
    await saveViewed('o', 'euw1', id, { profile: profile(id), matches: [] })
  expect(await loadViewed('o', 'euw1', 'a')).toBeNull()
  expect(await loadViewed('o', 'euw1', 'h')).not.toBeNull()
  expect((await listViewed('o')).map((r) => r.puuid)).toEqual(['h', 'g', 'f', 'e', 'd', 'c'])
})
it('moves players kept in localStorage by earlier versions, then clears them', async () => {
  localStorage.setItem('league-viewed:o', JSON.stringify(['league-viewed:o:euw1:old']))
  localStorage.setItem(
    'league-viewed:o:euw1:old',
    JSON.stringify({ profile: profile('old'), matches: [match('1')] }),
  )
  localStorage.setItem('league-viewed:o:euw1:broken', '{broken')
  expect((await listViewed('o')).map((r) => r.puuid)).toEqual(['old'])
  expect((await loadViewed('o', 'euw1', 'old'))?.matches).toHaveLength(1)
  expect(Object.keys(localStorage).some((k) => k.startsWith('league-viewed:'))).toBe(false)
})
