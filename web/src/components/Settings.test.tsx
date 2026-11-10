import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Settings } from './Settings'
import { riotRequest } from '../lib/league-repository'
vi.mock('../lib/league-repository', () => ({ riotRequest: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
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
it('keeps invalid-token failures actionable without claiming the token was saved', async () => {
  vi.mocked(riotRequest)
    .mockResolvedValueOnce({ configured: false, sharedDefault: false })
    .mockRejectedValueOnce(new Error('Riot rejected this token.'))
  render(<Settings onClose={() => {}} onSaved={() => {}} />)
  await screen.findByText('No Riot token saved yet.')
  await userEvent.type(screen.getByLabelText('Riot API token'), 'RGAPI-invalid')
  await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Riot rejected this token.')
  expect(screen.queryByText('Riot token saved and verified.')).not.toBeInTheDocument()
})
