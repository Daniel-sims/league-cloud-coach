import { expect, it, vi } from 'vitest'
import { cachedMatches } from './match-cache'
import type { LeagueMatch } from './league'

const game = (id: string, gameCreation: number) => ({ id, gameCreation }) as LeagueMatch

it('pages the first load, then fetches only games it does not hold', async () => {
  const all = Array.from({ length: 450 }, (_, i) => game(`G${i}`, 1000 - i))
  const fetchPage = vi.fn(async (_id: string, known: string[], limit: number) =>
    all.filter((m) => !known.includes(m.id)).slice(0, limit),
  )
  const first = await cachedMatches('profile-a', fetchPage)
  expect(first).toHaveLength(450)
  expect(first[0].id).toBe('G0')
  expect(fetchPage).toHaveBeenCalledTimes(3) // 200 + 200 + 50

  all.unshift(game('NEW', 2000))
  fetchPage.mockClear()
  const second = await cachedMatches('profile-a', fetchPage)
  expect(second[0].id).toBe('NEW')
  expect(second).toHaveLength(451)
  expect(fetchPage).toHaveBeenCalledTimes(1)
  expect(fetchPage.mock.calls[0][1]).toHaveLength(450)
})
