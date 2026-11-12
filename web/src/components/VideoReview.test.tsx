import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

it('asks the owner to sync before the first jump, then makes whole rows seek exactly', async () => {
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
  // The 3:00 kill sits at video 4:40 and seeks exactly there.
  await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(280))
  await userEvent.click(screen.getByLabelText('Video settings'))
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
  expect(player.seekTo).toHaveBeenCalledWith(760)

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
  await userEvent.click(screen.getByLabelText('Video settings (setup needed)'))
  expect(screen.getByText('No game attached')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Attach game' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Sync clock' })).toBeNull()
  await userEvent.click(within(row).getByRole('button', { name: 'Delete comment' }))
  await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(repo.deleteComment).toHaveBeenCalledWith('c3'))
})

it('remembers filter changes and never lists opponent purchases or absent fights', async () => {
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
  expect(screen.queryByText(/without you/)).toBeNull()
  await userEvent.click(screen.getByLabelText('Filter timeline'))
  expect(
    screen.queryByRole('checkbox', { name: /Opponent items|Flags|Fights without you/ }),
  ).toBeNull()
  await userEvent.click(screen.getByRole('checkbox', { name: /Kills/ }))
  expect(screen.queryByRole('button', { name: 'Killed Ahri' })).toBeNull()
  // A fight the player killed in still answers to the fight filter.
  expect(screen.getAllByRole('button', { name: 'Teamfight' })).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem('league-cloud-coach-hidden-kinds')!)).toEqual(['kill'])
  await userEvent.click(screen.getByRole('checkbox', { name: /Teamfights/ }))
  expect(screen.queryByRole('button', { name: 'Teamfight' })).toBeNull()
  expect(JSON.parse(localStorage.getItem('league-cloud-coach-hidden-kinds')!)).toEqual([
    'kill',
    'fight',
  ])
  await userEvent.click(screen.getByRole('checkbox', { name: /Teamfights/ }))
  expect(screen.getByRole('button', { name: 'Teamfight' })).toBeVisible()
})

it('seeks comments and ordinary events exactly, with lead-in only for ultimates and deaths including fight moments', async () => {
  const player = fakePlayer({ seconds: 700 })
  const review = reviewPayload()
  review.ultimates = { detectorVersion: 1, videoTimestampsMs: [650000] }
  review.kills.push({
    t: 800000,
    killer: 8,
    victim: 3,
    assists: [],
    x: 7400,
    y: 7400,
    turretDamage: 0,
  })
  const repo = repository('owner', {
    matchId: review.matchId,
    review,
    syncedAt: null,
    anchor: { gameTimeSeconds: 600, videoOffsetSeconds: 700 },
    comments: [comment({ videoMs: 760400 })],
  })
  render(<VideoReview repository={repo} renderPlayer={player.render} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Should I have backed here?' }))
  expect(player.seekTo).toHaveBeenLastCalledWith(760.4)
  await userEvent.click(screen.getByRole('button', { name: 'Killed Ahri' }))
  expect(player.seekTo).toHaveBeenLastCalledWith(280)
  await userEvent.click(screen.getByRole('button', { name: 'Teamfight' }))
  expect(player.seekTo).toHaveBeenLastCalledWith(700)
  await userEvent.click(screen.getByRole('button', { name: /10:00\s*Killed Ahri/ }))
  expect(player.seekTo).toHaveBeenLastCalledWith(700)
  await userEvent.click(screen.getByRole('button', { name: /10:02\s*Assisted killing LeeSin/ }))
  expect(player.seekTo).toHaveBeenLastCalledWith(702)
  await userEvent.click(screen.getByRole('button', { name: /10:04\s*Died to Syndra/ }))
  expect(player.seekTo).toHaveBeenLastCalledWith(699)
  await userEvent.click(screen.getByRole('button', { name: 'Died to Ahri' }))
  expect(player.seekTo).toHaveBeenLastCalledWith(895)
  await userEvent.click(screen.getByRole('button', { name: 'Cast ultimate' }))
  expect(player.seekTo).toHaveBeenLastCalledWith(645)
  await userEvent.click(screen.getByRole('button', { name: /^Infernal Drake taken/ }))
  expect(player.seekTo).toHaveBeenLastCalledWith(820)
})

it('keeps a clicked ultimate marked as current through its lead-in, then follows the playhead', async () => {
  const time = { seconds: 700 }
  const player = fakePlayer(time)
  const review = reviewPayload()
  review.ultimates = { detectorVersion: 1, videoTimestampsMs: [650000] }
  const repo = repository('owner', {
    matchId: review.matchId,
    review,
    syncedAt: null,
    anchor: { gameTimeSeconds: 600, videoOffsetSeconds: 700 },
    comments: [],
  })
  render(<VideoReview repository={repo} renderPlayer={player.render} />)
  const row = async () =>
    (await screen.findByRole('button', { name: 'Cast ultimate' })).closest('li') as HTMLElement
  await userEvent.click(await screen.findByRole('button', { name: 'Cast ultimate' }))
  // The seek lands five seconds early; the clicked row, not the previous one, stays current.
  expect(player.seekTo).toHaveBeenLastCalledWith(645)
  time.seconds = 645
  await waitFor(async () => expect(await row()).toHaveClass('current'))
  time.seconds = 652
  await waitFor(async () => expect(await row()).toHaveClass('current'))
  // Seeking elsewhere releases it.
  time.seconds = 300
  await waitFor(async () => expect(await row()).not.toHaveClass('current'))
})

it('groups linked comments under an event and saves new notes at event time, not the playhead', async () => {
  const event = {
    id: 'objective-720000',
    matchId: 'EUW1_1',
    gameMs: 720000,
    label: 'Infernal Drake taken by your team',
  }
  const repo = repository('owner', {
    matchId: 'EUW1_1',
    review: reviewPayload(),
    syncedAt: null,
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 10 },
    comments: [
      comment({ event, videoMs: 730000, body: 'Contest dragon?' }),
      comment({ id: 'legacy', videoMs: 730000, body: 'A general playhead note' }),
    ],
  })
  vi.mocked(repo.addComment).mockImplementationOnce(async (input) => {
    repo.data = { ...repo.data, comments: [...repo.data.comments, comment({ ...input, id: 'c2' })] }
  })
  render(<VideoReview repository={repo} renderPlayer={fakePlayer({ seconds: 500 }).render} />)
  const thread = await screen.findByRole('region', {
    name: 'Comments on Infernal Drake taken by your team at 12:00',
  })
  expect(within(thread).getByText('Contest dragon?')).toBeInTheDocument()
  expect(within(thread).queryByText('A general playhead note')).toBeNull()
  expect(screen.getByText('A general playhead note')).toBeInTheDocument()
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Infernal Drake taken by your team' }), {
    clientX: 200,
    clientY: 100,
  })
  await userEvent.click(screen.getByRole('menuitem', { name: 'Add comment' }))
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Killed Ahri' }), {
    clientX: 200,
    clientY: 100,
  })
  expect(screen.getByRole('menuitem', { name: 'Add comment' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await userEvent.type(within(thread).getByLabelText('Comment text'), 'Move as five.')
  await userEvent.click(within(thread).getByRole('button', { name: 'Add' }))
  expect(repo.addComment).toHaveBeenCalledWith(
    { videoMs: 730000, kind: 'comment', body: 'Move as five.', event },
    undefined,
  )
  expect(await within(thread).findByText('Move as five.')).toBeInTheDocument()
})

it('lets the owner mark key moments the guest can read and jump to but not change', async () => {
  const time = { seconds: 95.4 }
  const player = fakePlayer(time)
  const base: ReviewData = {
    matchId: 'EUW1_1',
    review: reviewPayload(),
    syncedAt: null,
    anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 0 },
    comments: [],
    moments: [{ id: 'm1', videoMs: 61_000, note: 'Why did I fight here?' }],
  }
  const owner = Object.assign(repository('owner', base), {
    addMoment: vi.fn(async () => {}),
    updateMoment: vi.fn(async () => {}),
    deleteMoment: vi.fn(async () => {}),
  })
  const view = render(<VideoReview repository={owner} renderPlayer={player.render} />)
  await userEvent.click(await screen.findByRole('button', { name: /Why did I fight here\?/ }))
  expect(player.seekTo).toHaveBeenCalledWith(61)
  await userEvent.click(screen.getByRole('button', { name: 'Mark this moment' }))
  await userEvent.type(screen.getByLabelText('Why this moment matters'), 'Wave state')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(owner.addMoment).toHaveBeenCalledWith(95_400, 'Wave state')
  await userEvent.click(screen.getByRole('button', { name: 'Remove key moment' }))
  expect(owner.deleteMoment).toHaveBeenCalledWith('m1')
  view.unmount()

  const guest = Object.assign(repository('coach', base), { guestName: 'Coach Sam' })
  render(<VideoReview repository={guest} renderPlayer={player.render} />)
  await userEvent.click(await screen.findByRole('button', { name: /Why did I fight here\?/ }))
  expect(player.seekTo).toHaveBeenLastCalledWith(61)
  expect(screen.queryByRole('button', { name: 'Mark this moment' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove key moment' })).toBeNull()
})

it('comments as the owner-named guest without asking for a name', async () => {
  const time = { seconds: 120 }
  const player = fakePlayer(time)
  const guest = Object.assign(
    repository('coach', {
      matchId: null,
      review: null,
      syncedAt: null,
      anchor: null,
      comments: [],
    }),
    { guestName: 'Coach Sam' },
  )
  render(<VideoReview repository={guest} renderPlayer={player.render} />)
  await userEvent.click(await screen.findByRole('button', { name: /Add comment|Comment/ }))
  expect(screen.queryByLabelText('Your name')).toBeNull()
  await userEvent.type(screen.getByLabelText('Comment text'), 'Nice trade')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() =>
    expect(guest.addComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Nice trade' }),
      'Coach Sam',
    ),
  )
})
