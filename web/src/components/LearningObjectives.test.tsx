import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LearningObjectives } from './LearningObjectives'
import type { LearningObjectives as Objectives, ObjectivesRepository } from '../lib/objectives'

function repo(initial: Objectives): ObjectivesRepository {
  return {
    get: vi.fn(async () => initial),
    save: vi.fn(async (revision, body) => ({
      body,
      revision: revision + 1,
      updatedAt: '2026-11-15T10:00:00Z',
    })),
  }
}
afterEach(cleanup)

it('renders saved objectives as markdown for reading', async () => {
  const repository = repo({
    body: '# This week\n\n- **Ward** river\n- [ ] Track jungler\n\n<script>alert(1)</script>',
    revision: 3,
    updatedAt: '2026-11-14T10:00:00Z',
  })
  const { container } = render(<LearningObjectives repository={repository} />)
  expect(await screen.findByRole('heading', { name: 'This week' })).toBeInTheDocument()
  expect(screen.getByText('Ward').tagName).toBe('STRONG')
  expect(screen.getByRole('checkbox')).toBeInTheDocument()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.queryByLabelText('Learning objectives')).toBeNull()
})

it('opens the editor when empty and autosaves the first version', async () => {
  const repository = repo({ body: '', revision: 0, updatedAt: null })
  render(<LearningObjectives repository={repository} />)
  await userEvent.type(await screen.findByLabelText('Learning objectives'), '- Farm')
  await userEvent.tab()
  await waitFor(() => expect(repository.save).toHaveBeenCalledWith(0, '- Farm'))
  expect(await screen.findByText(/Updated/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.getByRole('listitem')).toHaveTextContent('Farm')
})

it('edits existing objectives with the current revision', async () => {
  const repository = repo({ body: 'Old', revision: 4, updatedAt: '2026-11-14T10:00:00Z' })
  render(<LearningObjectives repository={repository} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await userEvent.type(screen.getByLabelText('Learning objectives'), '!')
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(repository.save).toHaveBeenCalledWith(4, 'Old!'))
  expect(await screen.findByText('Old!')).toBeInTheDocument()
})

it('stops saving and keeps the text when another tab changed the objectives', async () => {
  const repository = repo({ body: 'Old', revision: 4, updatedAt: null })
  vi.mocked(repository.save).mockRejectedValue(
    new Error('Your learning objectives changed in another tab. Reload to see the latest.'),
  )
  render(<LearningObjectives repository={repository} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await userEvent.type(screen.getByLabelText('Learning objectives'), '!')
  await userEvent.tab()
  expect(await screen.findByText(/changed in another tab/)).toBeInTheDocument()
  expect(screen.getByLabelText('Learning objectives')).toHaveValue('Old!')
  await userEvent.type(screen.getByLabelText('Learning objectives'), '?')
  await userEvent.tab()
  await act(async () => {})
  expect(repository.save).toHaveBeenCalledTimes(1)
})
