import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Home } from './Home'
import { match } from '../test/league-fixture'
import type { LeagueProfile } from '../lib/league'
import type { LeagueRepository } from '../lib/league-repository'

const profiles: LeagueProfile[] = [
  {
    id: 'one',
    platform: 'euw1',
    puuid: 'me',
    gameName: 'First',
    tagLine: 'EUW',
    profileIconId: 1,
    summonerLevel: 100,
    ranks: [],
    syncedAt: null,
  },
  {
    id: 'two',
    platform: 'na1',
    puuid: 'other',
    gameName: 'Second',
    tagLine: 'NA',
    profileIconId: 2,
    summonerLevel: 20,
    ranks: [],
    syncedAt: null,
  },
]
function repository(): LeagueRepository {
  return {
    profiles: vi.fn(async () => profiles),
    matches: vi.fn(async (id) => (id === 'one' ? [match('1'), match('2', { win: false })] : [])),
    refreshProfile: vi.fn(async () => {}),
    sync: vi.fn(async () => ({ nextStart: 2, hasMore: false })),
    connect: vi.fn(async () => ({ id: 'one' })),
  }
}
afterEach(() => {
  cleanup()
  localStorage.clear()
})
it('shows saved matches immediately, retains them on refresh failure and supports full scoreboards', async () => {
  const repo = repository()
  vi.mocked(repo.refreshProfile).mockRejectedValue(new Error('Riot is unavailable.'))
  render(<Home ownerId="owner" repository={repo} />)
  expect(await screen.findByText('50% win rate · 1W – 1L')).toBeVisible()
  expect(await screen.findByRole('alert')).toHaveTextContent('Riot is unavailable.')
  await userEvent.click(screen.getByRole('button', { name: /Scoreboard for 1/ }))
  expect(screen.getByText('Victory · Blue team')).toBeVisible()
  expect(screen.getByText('Defeat · Red team')).toBeVisible()
  expect(screen.getAllByRole('columnheader', { name: 'Damage / taken' })).toHaveLength(2)
})
it('filters rows without changing the full matchup record, and switching profiles clears prior games', async () => {
  render(<Home ownerId="owner" repository={repository()} />)
  await screen.findByText('50% win rate · 1W – 1L')
  await userEvent.selectOptions(screen.getByLabelText('Result'), 'win')
  expect(screen.getAllByRole('button', { name: /Scoreboard for/ })).toHaveLength(1)
  expect(screen.getByText('50% win rate · 1W – 1L')).toBeVisible()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh match history' })).toBeEnabled(),
  )
  await userEvent.selectOptions(screen.getByLabelText('League account'), 'two')
  await screen.findByText('Your match history is ready to sync')
  expect(screen.queryByRole('button', { name: /Scoreboard for/ })).not.toBeInTheDocument()
})
it('connects a selected region and keeps an actionable error in the form', async () => {
  const repo = repository()
  vi.mocked(repo.profiles).mockResolvedValue([])
  vi.mocked(repo.connect).mockRejectedValue(new Error('Check your Riot ID and region.'))
  render(<Home ownerId="owner" repository={repo} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Choose your League account' }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText('Riot ID'), 'Name#TAG')
  await userEvent.selectOptions(within(dialog).getByLabelText('Region'), 'na1')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add account' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Check your Riot ID and region.',
  )
  expect(repo.connect).toHaveBeenCalledWith('Name#TAG', 'na1')
})
it('shows dated game groups in the selected order and removes days with no filtered matches', async () => {
  const repo = repository()
  vi.mocked(repo.matches).mockResolvedValue([
    match('1', {}, { gameCreation: Date.UTC(2026, 10, 11, 18) }),
    match('2', {}, { gameCreation: Date.UTC(2026, 10, 11, 12) }),
    match('3', { win: false }, { gameCreation: Date.UTC(2026, 10, 10, 12) }),
  ])
  render(<Home ownerId="owner" repository={repo} />)
  const newer = await screen.findByRole('region', { name: 'Wednesday, 11 November 2026' })
  expect(within(newer).getByText('2 games')).toBeVisible()
  expect(
    within(screen.getByRole('region', { name: 'Tuesday, 10 November 2026' })).getByText('1 game'),
  ).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Sort'), 'oldest')
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
    'Tuesday, 10 November 2026',
    'Wednesday, 11 November 2026',
  ])
  await userEvent.selectOptions(screen.getByLabelText('Result'), 'win')
  expect(
    screen.queryByRole('region', { name: 'Tuesday, 10 November 2026' }),
  ).not.toBeInTheDocument()
})
