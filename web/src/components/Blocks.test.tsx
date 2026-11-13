import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { BlockList, BlockView } from './Blocks'
import type { Block, BlockRepository } from '../lib/blocks'

const block = (patch: Partial<Block> = {}): Block => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Block one',
  carryIn: ['Ward river at 3:00'],
  games: [{ id: 'g1', title: 'Ahri', notes: 'Died early' }],
  carryForward: ['Back on cooldowns'],
  revision: 1,
  createdAt: '2026-11-13T10:00:00Z',
  updatedAt: '2026-11-13T10:00:00Z',
  ...patch,
})
function repo(initial = block()): BlockRepository {
  return {
    list: vi.fn(async () => [initial]),
    create: vi.fn(async () => initial),
    save: vi.fn(async (_id, revision, draft) => ({
      ...initial,
      ...draft,
      revision: revision + 1,
    })),
    remove: vi.fn(async () => {}),
  }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.location.hash = ''
})

it('lists blocks and starts a new one', async () => {
  const repository = repo()
  render(<BlockList repository={repository} />)
  expect(await screen.findByText('Block one')).toBeInTheDocument()
  expect(screen.getByText(/1 game · 1 point to carry forward/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /new block/i }))
  expect(repository.create).toHaveBeenCalledWith('')
  await waitFor(() => expect(window.location.hash).toBe(`#/blocks/${block().id}`))
})

it('shows carried-in points at the top and saves game notes and summary points', async () => {
  const repository = repo()
  render(<BlockView id={block().id} repository={repository} />)
  expect(await screen.findByText('Ward river at 3:00')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Game 1 notes'), ' again')
  await userEvent.click(screen.getByRole('button', { name: /add game/i }))
  await userEvent.type(screen.getByLabelText('Game 2 notes'), 'Won lane')
  await userEvent.click(screen.getByRole('button', { name: /add point/i }))
  await userEvent.type(screen.getByLabelText('Carry-forward point 2'), '  Track jungler  ')
  await userEvent.click(screen.getByLabelText('Block title'))
  await userEvent.tab()
  await waitFor(() => expect(repository.save).toHaveBeenCalled())
  await screen.findByText('Saved')
  const [, , draft] = vi.mocked(repository.save).mock.calls.at(-1)!
  expect(draft.games.map((g) => g.notes)).toEqual(['Died early again', 'Won lane'])
  expect(draft.carryForward).toEqual(['Back on cooldowns', '  Track jungler  '])
})

it('stops saving and keeps the text when another tab changed the block', async () => {
  const repository = repo()
  vi.mocked(repository.save).mockRejectedValue(new Error('This block changed in another tab.'))
  render(<BlockView id={block().id} repository={repository} />)
  await userEvent.type(await screen.findByLabelText('Game 1 notes'), '!')
  await userEvent.tab()
  expect(await screen.findByText(/changed in another tab/)).toBeInTheDocument()
  expect(screen.getByLabelText('Game 1 notes')).toHaveValue('Died early!')
  await userEvent.type(screen.getByLabelText('Game 1 notes'), '?')
  await act(async () => {})
  expect(repository.save).toHaveBeenCalledTimes(1)
})

it('deletes a block after confirmation', async () => {
  const repository = repo()
  render(<BlockView id={block().id} repository={repository} />)
  await userEvent.click(await screen.findByRole('button', { name: /delete block/i }))
  await userEvent.click(screen.getAllByRole('button', { name: /delete block/i }).at(-1)!)
  await waitFor(() => expect(repository.remove).toHaveBeenCalledWith(block().id))
  expect(window.location.hash).toBe('#/blocks')
})
