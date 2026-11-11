import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import {
  CompleteReview,
  NotebookActions,
  ReviewNotebook,
  useReviewNotebook,
} from './ReviewNotebook'
import type { NotesInput, ReviewNotes, ReviewRepository } from '../lib/review'

afterEach(() => {
  cleanup()
  localStorage.clear()
})
function harness(saveNotes: (input: NotesInput) => Promise<ReviewNotes>) {
  const repository = {
    role: 'owner',
    load: async () => null,
    addComment: async () => {},
    updateComment: async () => {},
    deleteComment: async () => {},
    loadNotes: async () => ({ draft: null, reviews: [] }),
    saveNotes,
  } as ReviewRepository
  function TestNotebook() {
    const notebook = useReviewNotebook(repository)
    return (
      <>
        <NotebookActions notebook={notebook} />
        <ReviewNotebook notebook={notebook} />
        <CompleteReview notebook={notebook} />
      </>
    )
  }
  return render(<TestNotebook />)
}
const saved = (input: NotesInput): ReviewNotes => ({
  draft: { body: input.body, version: input.version + 1, author: null },
  reviews: input.complete
    ? [
        {
          id: 'r1',
          body: input.body.trim(),
          role: 'owner',
          author: null,
          completedAt: '2026-11-11T12:00:00Z',
          mine: true,
        },
      ]
    : [],
})

it('serializes completion behind an in-flight autosave and completes the latest edited notes', async () => {
  let release!: (value: ReviewNotes) => void
  const first = new Promise<ReviewNotes>((resolve) => {
    release = resolve
  })
  const save = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockImplementation(async (input: NotesInput) => saved(input))
  harness(save)
  const input = await screen.findByLabelText('Running notes')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.type(input, 'Push before roaming.')
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 })
  await userEvent.type(input, ' Bring vision.')
  await userEvent.click(screen.getAllByRole('button', { name: 'Complete review' })[0])
  const dialog = screen.getByRole('dialog', { name: 'Complete review' })
  expect(within(dialog).getByLabelText('Review notes')).toHaveValue(
    'Push before roaming. Bring vision.',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Complete review' }))
  expect(save).toHaveBeenCalledTimes(1)
  release(saved({ body: 'Push before roaming.', version: 0, complete: false }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save).toHaveBeenLastCalledWith({
    body: 'Push before roaming. Bring vision.',
    author: '',
    version: 1,
    complete: true,
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('region', { name: 'Completed reviews' })).toHaveTextContent(
    'Push before roaming. Bring vision.',
  )
})

it('keeps unsaved notes on a failed autosave and retries without clearing the text', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('Connection lost.'))
    .mockImplementation(async (input: NotesInput) => saved(input))
  harness(save)
  const input = await screen.findByLabelText('Running notes')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.type(input, 'Watch the first recall.')
  expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent(
    'Connection lost.',
  )
  expect(input).toHaveValue('Watch the first recall.')
  await userEvent.click(screen.getByRole('button', { name: 'Try saving again' }))
  await waitFor(() => expect(screen.getByText('Private draft saved')).toBeInTheDocument())
  expect(save).toHaveBeenLastCalledWith({
    body: 'Watch the first recall.',
    author: '',
    version: 0,
    complete: false,
  })
  expect(input).toHaveValue('Watch the first recall.')
})
