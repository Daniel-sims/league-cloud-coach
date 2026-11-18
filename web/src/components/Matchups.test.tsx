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

it('autosaves new notes, creating then updating the revision', async () => {
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
  const plan = await screen.findByRole('textbox', { name: 'Game plan' })
  await user.type(plan, 'Dodge his W shadow')
  await user.click(screen.getByRole('radio', { name: 'Hard' }))
  await user.tab()
  await waitFor(() => expect(repository.save).toHaveBeenCalled())
  expect(vi.mocked(repository.save).mock.calls[0].slice(0, 3)).toEqual([103, 238, 0])
  await user.click(screen.getAllByRole('button', { name: 'Add point' })[0])
  await user.keyboard('Death mark at 6{Enter}Ignite all-in')
  await user.tab()
  await waitFor(() =>
    expect(vi.mocked(repository.save).mock.lastCall?.[3]).toMatchObject({
      plan: 'Dodge his W shadow',
      difficulty: 'hard',
      threats: ['Death mark at 6', 'Ignite all-in'],
    }),
  )
  expect(vi.mocked(repository.save).mock.lastCall?.[2]).toBeGreaterThan(0)
  expect(await screen.findByText('Saved')).toBeInTheDocument()
})

it('shows your record in the matchup above the notes', async () => {
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
  expect(await screen.findByDisplayValue('Push and roam')).toBeInTheDocument()
  expect(await screen.findByText('67%')).toBeInTheDocument()
  expect(screen.getByText('2W 1L')).toBeInTheDocument()
  // Average of +900 and −500 gold at 15, over the games with timelines.
  expect(await screen.findByText('+200')).toBeInTheDocument()
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
