import { beforeEach, expect, it, vi } from 'vitest'
import { cachedMatches, clearMatchCache, storedMatches, type ChangeCursor } from './match-cache'
import type { LeagueMatch } from './league'

const game = (id: string, gameCreation: number) => ({ id, gameCreation }) as LeagueMatch

// A server log of changes: each write gets the next timestamp.
function server() {
  let clock = Date.parse('2026-11-16T10:00:00Z')
  const rows: { match: LeagueMatch; at: string }[] = []
  const write = (match: LeagueMatch) => {
    clock += 10_000
    const existing = rows.findIndex((r) => r.match.id === match.id)
    if (existing >= 0) rows.splice(existing, 1)
    rows.push({ match, at: new Date(clock).toISOString() })
  }
  const fetch = vi.fn(async (_id: string, after: ChangeCursor | null, limit: number) => {
    const page = rows
      .filter((r) => !after || r.at > after.at || (r.at === after.at && r.match.id > after.id))
      .slice(0, limit)
    const last = page.at(-1)
    return {
      matches: page.map((r) => r.match),
      cursor: last ? { at: last.at, id: last.match.id } : null,
    }
  })
  return { write, fetch }
}

beforeEach(() => clearMatchCache())

it('pages the first load, then asks only for changes after its cursor', async () => {
  const s = server()
  for (let i = 0; i < 450; i++) s.write(game(`G${i}`, 1000 - i))
  const first = await cachedMatches('profile-a', s.fetch)
  expect(first).toHaveLength(450)
  expect(first[0].id).toBe('G0')
  expect(s.fetch).toHaveBeenCalledTimes(3) // 200 + 200 + 50
  expect(s.fetch.mock.calls[0][1]).toBeNull()

  s.write(game('NEW', 2000))
  s.fetch.mockClear()
  const second = await cachedMatches('profile-a', s.fetch)
  expect(second[0].id).toBe('NEW')
  expect(second).toHaveLength(451)
  expect(s.fetch).toHaveBeenCalledTimes(1)
  // The cursor is sent (rewound for late commits), never the list of held ids.
  expect(s.fetch.mock.calls[0][1]).toMatchObject({ id: '' })
})

it('picks up a backfilled old game without reloading the history', async () => {
  const s = server()
  s.write(game('OLD', 1))
  s.write(game('RECENT', 2))
  await cachedMatches('profile-b', s.fetch)
  s.write({ ...game('OLD', 1), queueId: 420 } as LeagueMatch)
  const next = await cachedMatches('profile-b', s.fetch)
  expect(next.find((m) => m.id === 'OLD')?.queueId).toBe(420)
  expect(next).toHaveLength(2)
})

it('shows what it holds before the network answers', async () => {
  const s = server()
  s.write(game('A', 1))
  expect(await storedMatches('profile-c')).toBeNull()
  await cachedMatches('profile-c', s.fetch)
  expect((await storedMatches('profile-c'))?.map((m) => m.id)).toEqual(['A'])
})

it('shares one refresh between simultaneous callers', async () => {
  const s = server()
  s.write(game('A', 1))
  await Promise.all([cachedMatches('profile-d', s.fetch), cachedMatches('profile-d', s.fetch)])
  expect(s.fetch).toHaveBeenCalledTimes(1)
})
