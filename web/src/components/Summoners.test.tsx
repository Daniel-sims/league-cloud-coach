import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { SummonerProfile, SummonerSearch } from './Summoners'
import { match } from '../test/league-fixture'
import type { LeagueProfile } from '../lib/league'
import type { LeagueRepository } from '../lib/league-repository'

const mine: LeagueProfile = {
  id: 'one',
  platform: 'euw1',
  puuid: 'me',
  gameName: 'First',
  tagLine: 'EUW',
  profileIconId: 1,
  summonerLevel: 100,
  ranks: [],
  syncedAt: null,
}
const zed = { gameName: 'Zed', tagLine: 'EUW', profileIconId: 3, summonerLevel: 150, ranks: [] }
// The looked-up player's game, with your own account and a stranger in it.
function viewedGame() {
  const game = match('9', { puuid: 'enemy', championName: 'Zed', championId: 238 })
  game.participants[1] = { ...game.participants[1], puuid: 'me', championName: 'Ahri' }
  game.participants[2] = { ...game.participants[2], puuid: 'third', championName: 'Yone' }
  return game
}
function repository(): LeagueRepository {
  return {
    profiles: vi.fn(async () => [mine]),
    matches: vi.fn(async () => []),
    refreshProfile: vi.fn(async () => {}),
    sync: vi.fn(async () => ({ nextStart: 0, hasMore: false })),
    syncTimelines: vi.fn(async () => ({ done: 0, remaining: 0 })),
    connect: vi.fn(async () => ({ id: 'one' })),
    findPlayer: vi.fn(async () => ({ puuid: 'enemy', profile: zed })),
    viewPlayer: vi.fn(async () => ({ profile: zed })),
    matchRanks: vi.fn(async () => ({ ranks: {} })),
    viewMatches: vi.fn(async () => ({
      ids: ['9'],
      matches: [viewedGame()],
      nextStart: 5,
      hasMore: false,
    })),
  }
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  window.location.hash = ''
})

it('finds a player by Riot ID, remembers them and opens their profile', async () => {
  const repo = repository()
  render(<SummonerSearch ownerId="owner" repository={repo} />)
  expect(screen.getByText('No one looked up yet')).toBeVisible()
  await userEvent.type(screen.getByLabelText('Riot ID'), 'Zed#EUW')
  await userEvent.selectOptions(screen.getByLabelText('Region'), 'na1')
  await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
  await waitFor(() => expect(window.location.hash).toBe('#/summoners/na1/enemy'))
  expect(repo.findPlayer).toHaveBeenCalledWith('na1', 'Zed#EUW')
  expect(repo.connect).not.toHaveBeenCalled()
  cleanup()
  render(<SummonerSearch ownerId="owner" repository={repo} />)
  expect(screen.getByRole('link', { name: /Zed#EUW/ })).toHaveAttribute(
    'href',
    '#/summoners/na1/enemy',
  )
})

it('keeps an actionable lookup error on the page', async () => {
  const repo = repository()
  vi.mocked(repo.findPlayer).mockRejectedValue(new Error('No player has that Riot ID.'))
  render(<SummonerSearch ownerId="owner" repository={repo} />)
  await userEvent.type(screen.getByLabelText('Riot ID'), 'Nobody#000')
  await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No player has that Riot ID.')
  expect(window.location.hash).toBe('')
})

it('loads a player’s profile and games without saving them, and caches for next time', async () => {
  const repo = repository()
  render(<SummonerProfile ownerId="owner" platform="euw1" puuid="enemy" repository={repo} />)
  expect(await screen.findByRole('button', { name: /Scoreboard for 9/ })).toBeVisible()
  expect(repo.viewPlayer).toHaveBeenCalledWith('euw1', 'enemy')
  expect(repo.viewMatches).toHaveBeenCalledWith('euw1', 'enemy', 0, expect.any(Array))
  expect(screen.getAllByText('Zed#EUW').length).toBeGreaterThan(0)
  expect(repo.connect).not.toHaveBeenCalled()
  expect(repo.sync).not.toHaveBeenCalled()
  expect(Object.keys(localStorage).some((k) => k.startsWith('league-viewed:'))).toBe(true)
})

it('links a clicked player to their profile, and your own account to Home', async () => {
  render(
    <SummonerProfile ownerId="owner" platform="euw1" puuid="enemy" repository={repository()} />,
  )
  await userEvent.click(await screen.findByRole('button', { name: /Scoreboard for 9/ }))
  await userEvent.click(screen.getAllByTitle("Open Yone's profile")[0])
  expect(window.location.hash).toBe('#/summoners/euw1/third')
  await userEvent.click(screen.getAllByTitle("Open Ahri's profile")[0])
  expect(window.location.hash).toBe('#/home')
})

it('says so when the player is one of your own accounts', async () => {
  render(<SummonerProfile ownerId="owner" platform="euw1" puuid="me" repository={repository()} />)
  expect(await screen.findByRole('status')).toHaveTextContent('This is one of your accounts.')
  expect(screen.getByRole('link', { name: 'Open Home' })).toHaveAttribute('href', '#/home')
})
