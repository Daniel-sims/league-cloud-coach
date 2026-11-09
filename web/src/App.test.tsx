import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

vi.mock('./components/Player', () => ({
  Player: ({ title }: { title: string }) => <div aria-label="Video player">{title}</div>,
}))
beforeEach(() => {
  cleanup()
  localStorage.clear()
  window.location.hash = '/preview'
})

it('adds, searches, renames, copies the actual YouTube link, and removes a recording', async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Your next review starts here' })
  await user.click(screen.getByRole('button', { name: 'Add your first video' }))
  await user.type(screen.getByLabelText('YouTube link'), 'https://youtu.be/aB3_dE-fG09?t=42')
  await user.type(screen.getByLabelText('Title'), 'Twisted Fate vs Ahri')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add video' }))
  await screen.findByRole('link', { name: 'Twisted Fate vs Ahri' })
  await user.type(screen.getByRole('searchbox'), 'no match')
  expect(screen.getByRole('heading', { name: 'No games found' })).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox'))
  await user.click(screen.getByRole('button', { name: 'Share' }))
  expect(screen.getByLabelText('YouTube link')).toHaveValue(
    'https://www.youtube.com/watch?v=aB3_dE-fG09',
  )
  await user.click(screen.getByRole('button', { name: 'Close dialog' }))
  await user.click(screen.getByLabelText('More actions for Twisted Fate vs Ahri'))
  await user.click(screen.getByRole('button', { name: 'Rename' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'My coaching review')
  await user.click(screen.getByRole('button', { name: 'Save title' }))
  await screen.findByRole('link', { name: 'My coaching review' })
  await user.click(screen.getByLabelText('More actions for My coaching review'))
  await user.click(screen.getByRole('button', { name: 'Remove from library' }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove from library' }),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Your next review starts here' }),
    ).toBeInTheDocument(),
  )
})

it('shows an unavailable state for malformed share capabilities without sign-in', async () => {
  window.location.hash = '/watch/invalid'
  render(<App />)
  await screen.findByRole('heading', { name: 'This game isn’t shared here.' })
  expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
})
