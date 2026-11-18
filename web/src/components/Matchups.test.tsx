import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MatchupsHome, MatchupView } from './Matchups'
import type { LeagueRepository } from '../lib/league-repository'
import type { MatchupNote, MatchupRepository } from '../lib/matchups'
import { match } from '../test/league-fixture'

// You are Ahri (103) mid; the enemy mid is Zed (238).
function league(): LeagueRepository {
  return {
    profiles: vi.fn(async () => [
      {
        id: 'p1',
        platform: 'euw1',
        puuid: 'me',
        gameName: 'Me',
        tagLine: 'EUW',
        profileIconId: 1,
        summonerLevel: 100,
        ranks: [],
        syncedAt: null,
      },
    ]),
    matches: vi.fn(async () => [match('EUW1_1'), match('EUW1_2', { win: false }), match('EUW1_3')]),
    syncTimelines: vi.fn(async () => ({ done: 1, remaining: 0 })),
  } as unknown as LeagueRepository
}
function notes(initial: MatchupNote[] = []): MatchupRepository {
  return {
    list: vi.fn(async () => initial),
    save: vi.fn(async (championId, opponentId, revision, draft) => ({
      ...draft,
      championId,
      opponentId,
      revision: revision + 1,
    })),
    remove: vi.fn(async () => {}),
    lanes: vi.fn(async () => ({
      EUW1_1: [
        [0, 0, 0, 0],
        [600, 400, 6, 200],
        [900, 900, 10, 300],
      ],
      EUW1_2: [
        [0, 0, 0, 0],
        [600, -300, -4, -100],
        [900, -500, -8, -200],
      ],
    })),
  } as unknown as MatchupRepository
}
beforeEach(() => {
  // No Data Dragon in tests: champion names come from synced games.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.location.hash = ''
})

it('writes notes in an edit form and shows them read-only after saving', async () => {
  const repository = notes()
  const user = userEvent.setup()
  render(
    <MatchupView
      championId={103}
      opponentId={238}
      tab="notes"
      league={league()}
      repository={repository}
    />,
  )
  // Nothing written yet: a prompt, not a form.
  expect(await screen.findByText('No notes for Ahri vs Zed yet')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Game plan' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Write notes' }))
  await user.type(screen.getByRole('textbox', { name: 'Game plan' }), 'Dodge his W shadow')
  await user.click(screen.getByRole('radio', { name: 'Hard' }))
  await user.click(screen.getAllByRole('button', { name: 'Add point' })[0])
  await user.keyboard('Death mark at 6{Enter}Ignite all-in')
  expect(repository.save).not.toHaveBeenCalled() // nothing saves until Save
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1))
  expect(vi.mocked(repository.save).mock.calls[0].slice(0, 3)).toEqual([103, 238, 0])
  expect(vi.mocked(repository.save).mock.calls[0][3]).toMatchObject({
    plan: 'Dodge his W shadow',
    difficulty: 'hard',
    threats: ['Death mark at 6', 'Ignite all-in'],
  })
  // Back to reading: text, not inputs.
  expect(await screen.findByText('Dodge his W shadow')).toBeInTheDocument()
  expect(screen.getByText('Hard matchup')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Watch out for' })).toHaveTextContent('Ignite all-in')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  // Editing again uses the saved revision.
  await user.click(screen.getByRole('button', { name: 'Edit notes' }))
  await user.type(screen.getByRole('textbox', { name: 'Game plan' }), '!')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(vi.mocked(repository.save).mock.lastCall?.[2]).toBe(1))
})

it('asks before discarding edits, and Cancel without edits just closes', async () => {
  const repository = notes([
    {
      championId: 103,
      opponentId: 238,
      revision: 2,
      difficulty: null,
      plan: 'Push and roam',
      threats: [],
      tips: [],
      build: '',
      notes: '',
      runes: null,
    },
  ])
  const user = userEvent.setup()
  render(
    <MatchupView
      championId={103}
      opponentId={238}
      tab="notes"
      league={league()}
      repository={repository}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Edit notes' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit notes' }))
  await user.type(screen.getByRole('textbox', { name: 'Game plan' }), ' fast')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  const dialog = screen.getByRole('dialog', { name: 'Discard your changes?' })
  await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
  expect(screen.getByText('Push and roam')).toBeInTheDocument()
  expect(repository.save).not.toHaveBeenCalled()
})

it('keeps the notes tab to notes; history lives on the stats tab', async () => {
  render(
    <MatchupView
      championId={103}
      opponentId={238}
      tab="notes"
      league={league()}
      repository={notes([
        {
          championId: 103,
          opponentId: 238,
          revision: 3,
          difficulty: 'even',
          plan: 'Push and roam',
          threats: ['Level 6 all-in'],
          tips: [],
          build: '',
          notes: '',
          runes: null,
        },
      ])}
    />,
  )
  expect(await screen.findByText('Push and roam')).toBeInTheDocument()
  expect(screen.queryByText('2W 1L')).not.toBeInTheDocument()
  expect(screen.queryByText(/gold at 15/)).not.toBeInTheDocument()
})

it('summarises the lane on the stats tab and fetches missing timelines', async () => {
  const leagueRepo = league()
  const user = userEvent.setup()
  render(
    <MatchupView
      championId={103}
      opponentId={238}
      tab="stats"
      league={leagueRepo}
      repository={notes()}
    />,
  )
  expect(await screen.findByText('Gold difference at 15')).toBeInTheDocument()
  expect(screen.getByText('2W 1L · 3 games')).toBeInTheDocument()
  expect(
    screen.getByRole('img', { name: 'Last 3 results, newest first: win, loss, win' }),
  ).toBeInTheDocument()
  // Gold at 15 and CS at 10 are each ahead in one of the two games with timelines.
  expect(await screen.findAllByText('Ahead in 1 of 2')).toHaveLength(2)
  expect(screen.getByText('+1')).toBeInTheDocument() // CS at 10: (6 − 4) / 2
  expect(screen.getByRole('img', { name: /Gold difference by minute/ })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Fetch timelines' }))
  await waitFor(() => expect(leagueRepo.syncTimelines).toHaveBeenCalledTimes(1))
  expect(vi.mocked(leagueRepo.syncTimelines).mock.calls[0][0]).toBe('p1')
})

it('picks a matchup by typing champion names', async () => {
  const user = userEvent.setup()
  render(<MatchupsHome league={league()} repository={notes()} />)
  // Starts from the champion you played last, and offers opponents you've faced on it.
  expect(await screen.findByTitle('Ahri vs Zed')).toHaveAttribute('href', '#/matchups/103/238')
  const opponent = screen.getByRole('combobox', { name: 'Lane opponent' })
  await user.type(opponent, 'ze{Enter}')
  await user.click(screen.getByRole('button', { name: /Open matchup/ }))
  expect(window.location.hash).toBe('#/matchups/103/238')
})

it('shows a live game with the likely lane opponent picked', async () => {
  const leagueRepo = league()
  leagueRepo.liveGame = vi.fn(async () => ({
    inGame: true as const,
    queueId: 420,
    gameStartTime: Date.now() - 5 * 60000,
    championId: 103,
    allies: [{ championId: 103, spells: [4, 14] }],
    enemies: [
      { championId: 64, spells: [4, 11] },
      { championId: 238, spells: [4, 14] },
      { championId: 222, spells: [4, 7] },
    ],
  }))
  const user = userEvent.setup()
  render(
    <MatchupsHome
      league={leagueRepo}
      repository={notes([
        {
          championId: 103,
          opponentId: 238,
          revision: 1,
          difficulty: 'hard',
          plan: 'Hold Charm for his shadow',
          threats: [],
          tips: [],
          build: '',
          notes: '',
          runes: null,
        },
      ])}
    />,
  )
  expect(await screen.findByText('In game')).toBeInTheDocument()
  expect(screen.getByText(/5 min/)).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Zed/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByText('Likely')).toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: 'Live game' })).getByText(
      'Hold Charm for his shadow',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Read your notes: Ahri vs Zed/ })).toHaveAttribute(
    'href',
    '#/matchups/103/238',
  )
  await user.click(screen.getByRole('radio', { name: /Jinx/ }))
  expect(screen.getByRole('link', { name: /Open matchup: Ahri vs Jinx/ })).toHaveAttribute(
    'href',
    '#/matchups/103/222',
  )
})

it('says when you are not in a game', async () => {
  const leagueRepo = league()
  leagueRepo.liveGame = vi.fn(async () => ({ inGame: false as const }))
  render(<MatchupsHome league={leagueRepo} repository={notes()} />)
  expect(await screen.findByText(/Not in a game/)).toBeInTheDocument()
  expect(leagueRepo.liveGame).toHaveBeenCalledWith('p1')
})

it('moves text from the old build box into the notes', async () => {
  const repository = notes([
    {
      championId: 103,
      opponentId: 238,
      revision: 2,
      difficulty: null,
      plan: '',
      threats: [],
      tips: [],
      build: 'Dorans Ring, Zhonya rush',
      notes: 'Ward his side',
      runes: null,
    },
  ])
  const user = userEvent.setup()
  render(
    <MatchupView
      championId={103}
      opponentId={238}
      tab="notes"
      league={league()}
      repository={repository}
    />,
  )
  expect(await screen.findByRole('region', { name: 'Notes' })).toHaveTextContent(
    'Dorans Ring, Zhonya rush Ward his side',
  )
  await user.click(screen.getByRole('button', { name: 'Edit notes' }))
  const box = screen.getByRole('textbox', { name: 'Notes' })
  expect(box).toHaveValue('Dorans Ring, Zhonya rush\n\nWard his side')
  expect(screen.queryByRole('textbox', { name: /Items/ })).not.toBeInTheDocument()
  await user.type(box, '.')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(vi.mocked(repository.save).mock.lastCall?.[3]).toMatchObject({
      build: '',
      notes: 'Dorans Ring, Zhonya rush\n\nWard his side.',
    }),
  )
})
