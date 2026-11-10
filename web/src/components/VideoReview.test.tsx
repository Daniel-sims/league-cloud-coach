import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { VideoReview } from './VideoReview'
import type { PlayerController } from '../lib/player'
import type { ReviewComment, ReviewData, ReviewRepository } from '../lib/review'
import { reviewPayload } from '../test/review-fixture'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function fakePlayer(time: { seconds: number }, seekTo = vi.fn()) {
  function FakePlayer({ onController }: { onController(c: PlayerController | null): void }) {
    useEffect(() => {
      onController({ currentTime: () => time.seconds, duration: () => 1800, seekTo })
      return () => onController(null)
    }, [onController])
    return <div>video</div>
  }
  return {
    seekTo,
    render: (onController: (c: PlayerController | null) => void) => (
      <FakePlayer onController={onController} />
    ),
  }
}
const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  videoMs: 760_000,
  kind: 'question',
  body: 'Should I have backed here?',
  role: 'owner',
  author: null,
  mine: true,
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-10T10:00:00Z',
  ...over,
})
function repository(
  role: 'owner' | 'coach',
  initial: ReviewData,
): ReviewRepository & { data: ReviewData } {
  const repo = {
    role,
    data: initial,
    load: vi.fn(async () => repo.data),
    addComment: vi.fn(async () => {}),
    updateComment: vi.fn(async () => {}),
    deleteComment: vi.fn(async () => {}),
    ...(role === 'owner'
      ? {
          setAnchor: vi.fn(async (anchor) => {
            repo.data = { ...repo.data, anchor }
          }),
          attachMatch: vi.fn(async () => {}),
          detachMatch: vi.fn(async () => {}),
        }
      : {}),
  }
  return repo as ReviewRepository & { data: ReviewData }
}

it('asks the owner to sync before the first jump, then makes whole rows seek with pre-roll', async () => {
  const time = { seconds: 700 }
  const player = fakePlayer(time)
  const repo = repository('owner', {
    matchId: 'EUW1_1',
    review: reviewPayload(),
    syncedAt: null,
    anchor: null,
    comments: [],
  })
  render(<VideoReview repository={repo} renderPlayer={player.render} />)
  // Clicking the row body, not just its title, of an unsynced event asks for the clock first.
  await userEvent.click(await screen.findByText('Solo kill'))
  expect(screen.queryByRole('dialog')).toBeNull()
  const dialog = screen.getByRole('form', { name: 'Sync game clock' })
  expect(within(dialog).getByText('11:40')).toBeVisible()
  expect(within(dialog).getByText(/jumps to the 3:00 event/)).toBeVisible()
  await userEvent.type(within(dialog).getByLabelText('In-game clock'), '10:00')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sync' }))
  expect(repo.setAnchor).toHaveBeenCalledWith({ gameTimeSeconds: 600, videoOffsetSeconds: 700 })
  // The 3:00 kill sits at video 4:40; seeks land five seconds early.
  await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(275))
  await userEvent.click(screen.getByLabelText('Timeline settings'))
  expect(screen.getByText('10:00 at 11:40 in the video')).toBeInTheDocument()
  // Lane checkpoints and purchases open exactly on their time: the 4:00
  // matchup is video 5:40 and the 0:10 opening buy is video 1:50.
  await userEvent.click(screen.getByText('+300'))
  expect(player.seekTo).toHaveBeenLastCalledWith(340)
  await userEvent.click(screen.getByRole('button', { name: 'Opening buy' }))
  expect(player.seekTo).toHaveBeenLastCalledWith(110)
})

it('does not open the sync dialog when an unsynced-event click is cancelled, and coaches cannot sync', async () => {
  const owner = repository('owner', {
    matchId: 'EUW1_1',
    review: reviewPayload(),
    syncedAt: null,
    anchor: null,
    comments: [],
  })
  const player = fakePlayer({ seconds: 10 })
  const view = render(<VideoReview repository={owner} renderPlayer={player.render} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Killed Ahri' }))
  await userEvent.click(
    within(screen.getByRole('form', { name: 'Sync game clock' })).getByRole('button', {
      name: 'Cancel',
    }),
  )
  expect(screen.queryByRole('form', { name: 'Sync game clock' })).toBeNull()
  expect(player.seekTo).not.toHaveBeenCalled()
  view.unmount()
  const coach = repository('coach', { ...owner.data })
  render(<VideoReview repository={coach} renderPlayer={fakePlayer({ seconds: 10 }).render} />)
  expect(await screen.findByRole('button', { name: 'Killed Ahri' })).toBeDisabled()
})

it('lets a coach add named comments at the playhead and only edit their own', async () => {
  const time = { seconds: 765.4 }
  const player = fakePlayer(time)
  const repo = repository('coach', {
    matchId: 'EUW1_1',
    review: reviewPayload(),
    syncedAt: null,
    anchor: { gameTimeSeconds: 600, videoOffsetSeconds: 700 },
    comments: [comment({ mine: false })],
  })
  render(<VideoReview repository={repo} renderPlayer={player.render} />)
  const owners = await screen.findByText('Should I have backed here?')
  const ownerRow = owners.closest('li')!
  expect(within(ownerRow).getByText('Player')).toBeVisible()
  expect(within(ownerRow).getByText('11:00')).toBeVisible()
  expect(within(ownerRow).queryByRole('button', { name: 'Edit comment' })).toBeNull()
  expect(within(ownerRow).queryByRole('button', { name: 'Delete comment' })).toBeNull()
  await userEvent.click(owners)
  expect(player.seekTo).toHaveBeenCalledWith(757)

  await userEvent.click(screen.getByRole('button', { name: 'Comment' }))
  expect(screen.getByText('New at 11:05')).toBeVisible()
  expect(screen.queryByRole('radio', { name: 'Mindset' })).toBeNull()
  const add = screen.getByRole('button', { name: 'Add' })
  await userEvent.type(screen.getByLabelText('Comment text'), 'Ward the raptors first')
  expect(add).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Your name'), 'Coach Sam')
  repo.data = {
    ...repo.data,
    comments: [
      ...repo.data.comments,
      comment({
        id: 'c2',
        role: 'coach',
        author: 'Coach Sam',
        mine: true,
        body: 'Ward the raptors first',
        kind: 'comment',
        videoMs: 765_400,
      }),
    ],
  }
  await userEvent.click(add)
  expect(repo.addComment).toHaveBeenCalledWith(
    { videoMs: 765_400, kind: 'comment', body: 'Ward the raptors first' },
    'Coach Sam',
  )
  expect(localStorage.getItem('league-cloud-coach-coach-name')).toBe('Coach Sam')
  await userEvent.click(screen.getByRole('button', { name: 'Comment' }))
  expect(screen.queryByLabelText('Your name')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  const mine = (await screen.findByText('Ward the raptors first')).closest('li')!
  expect(within(mine).getByText('You')).toBeVisible()
  await userEvent.click(within(mine).getByRole('button', { name: 'Delete comment' }))
  await userEvent.click(within(mine).getByRole('button', { name: 'Delete' }))
  expect(repo.deleteComment).toHaveBeenCalledWith('c2')
})

it('lets the owner remove but not rewrite a coach comment, and keeps comments without a game attached', async () => {
  const player = fakePlayer({ seconds: 10 })
  const repo = repository('owner', {
    matchId: null,
    review: null,
    syncedAt: null,
    anchor: null,
    comments: [
      comment({
        id: 'c3',
        role: 'coach',
        author: 'Coach Sam',
        mine: false,
        body: 'Too far forward',
        kind: 'comment',
        videoMs: 90_000,
      }),
    ],
  })
  render(<VideoReview repository={repo} renderPlayer={player.render} />)
  const row = (await screen.findByText('Too far forward')).closest('li')!
  expect(within(row).getByText('Coach Sam')).toBeVisible()
  expect(within(row).getByText('Coach')).toBeVisible()
  expect(within(row).getByText('video')).toBeVisible()
  expect(within(row).queryByRole('button', { name: 'Edit comment' })).toBeNull()
  await userEvent.click(screen.getByLabelText('Timeline settings (setup needed)'))
  expect(screen.getByText('No game attached')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Attach game' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Sync clock' })).toBeNull()
  await userEvent.click(within(row).getByRole('button', { name: 'Delete comment' }))
  await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(repo.deleteComment).toHaveBeenCalledWith('c3'))
})

it('hides opponent purchases by default and remembers filter changes', async () => {
  const repo = repository('coach', {
    matchId: 'EUW1_1',
    review: reviewPayload(),
    syncedAt: null,
    anchor: null,
    comments: [],
  })
  render(<VideoReview repository={repo} renderPlayer={fakePlayer({ seconds: 0 }).render} />)
  await screen.findByRole('button', { name: 'Killed Ahri' })
  expect(screen.queryByText('Ahri bought 1 item')).toBeNull()
  await userEvent.click(screen.getByLabelText('Filter timeline'))
  await userEvent.click(screen.getByRole('checkbox', { name: /Opponent items/ }))
  expect(screen.getByText('Ahri bought 1 item')).toBeVisible()
  await userEvent.click(screen.getByRole('checkbox', { name: /Kills/ }))
  expect(screen.queryByRole('button', { name: 'Killed Ahri' })).toBeNull()
  // A fight the player killed in still answers to the fight filter.
  expect(screen.getAllByRole('button', { name: 'Teamfight' })).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem('league-cloud-coach-hidden-kinds')!)).toEqual(['kill'])
})
