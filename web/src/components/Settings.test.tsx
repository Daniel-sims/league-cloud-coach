import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Settings } from './Settings'
import { leagueRepository, riotRequest } from '../lib/league-repository'
vi.mock('../lib/league-repository', () => ({
  riotRequest: vi.fn(),
  leagueRepository: { profiles: vi.fn(), matches: vi.fn(), sync: vi.fn() },
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
beforeEach(() => {
  vi.mocked(leagueRepository.profiles).mockResolvedValue([])
})
it('masks the token, clears it after saving and never reads a saved token back', async () => {
  vi.mocked(riotRequest).mockResolvedValue({ configured: false, sharedDefault: false })
  const saved = vi.fn()
  render(<Settings onClose={() => {}} onSaved={saved} />)
  await screen.findByText('No Riot token saved yet.')
  const input = screen.getByLabelText('Riot API token')
  expect(input).toHaveAttribute('type', 'password')
  await userEvent.type(input, 'RGAPI-fake-test-token')
  await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
  expect(await screen.findByText('Riot token saved and verified.')).toBeVisible()
  expect(input).toHaveValue('')
  expect(saved).toHaveBeenCalledOnce()
  expect(riotRequest).toHaveBeenLastCalledWith({
    action: 'save-token',
    token: 'RGAPI-fake-test-token',
    platform: 'euw1',
  })
})
it('keeps storage failures actionable without claiming the token was saved', async () => {
  vi.mocked(riotRequest)
    .mockResolvedValueOnce({ configured: false, sharedDefault: false })
    .mockRejectedValueOnce(new Error('Could not save your Riot token.'))
  render(<Settings onClose={() => {}} onSaved={() => {}} />)
  await screen.findByText('No Riot token saved yet.')
  await userEvent.type(screen.getByLabelText('Riot API token'), 'RGAPI-invalid')
  await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your Riot token.')
  expect(screen.queryByText('Riot token saved and verified.')).not.toBeInTheDocument()
})
it('shows the saved-token propagation warning and clears the input without claiming verification', async () => {
  const warning =
    'Token saved. If you just generated it, it may take a few minutes to start working.'
  vi.mocked(riotRequest)
    .mockResolvedValueOnce({ configured: false, sharedDefault: false })
    .mockResolvedValueOnce({ verified: false, warning })
  const saved = vi.fn()
  render(<Settings onClose={() => {}} onSaved={saved} />)
  await screen.findByText('No Riot token saved yet.')
  await userEvent.type(screen.getByLabelText('Riot API token'), 'RGAPI-new-token')
  await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
  expect(await screen.findByRole('status')).toHaveTextContent(warning)
  expect(screen.getByLabelText('Riot API token')).toHaveValue('')
  expect(saved).toHaveBeenCalledOnce()
  expect(screen.queryByText('Riot token saved and verified.')).not.toBeInTheDocument()
})

it('syncs pages until the chosen season is fully reached', async () => {
  vi.mocked(riotRequest).mockResolvedValue({ configured: true, sharedDefault: false })
  vi.mocked(leagueRepository.profiles).mockResolvedValue([
    { id: 'p1', gameName: 'Me', tagLine: 'EUW' },
  ] as never)
  const game = (v: string) => ({ gameVersion: v })
  vi.mocked(leagueRepository.matches)
    .mockResolvedValueOnce([game('16.3.1')] as never) // season options
    .mockResolvedValueOnce([game('16.3.1')] as never)
    .mockResolvedValueOnce([game('16.3.1'), game('15.24.1')] as never)
  vi.mocked(leagueRepository.sync)
    .mockResolvedValueOnce({ nextStart: 5, hasMore: true })
    .mockResolvedValueOnce({ nextStart: 10, hasMore: true })
  const saved = vi.fn()
  render(<Settings onClose={() => {}} onSaved={saved} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sync full season' }))
  expect(await screen.findByText(/Season 16 history is synced/)).toBeVisible()
  expect(leagueRepository.sync).toHaveBeenCalledTimes(2)
  expect(leagueRepository.sync).toHaveBeenLastCalledWith('p1', 5)
  expect(saved).toHaveBeenCalled()
})
