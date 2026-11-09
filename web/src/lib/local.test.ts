import { beforeEach, expect, it } from 'vitest'
import { localRepository } from './local'

beforeEach(() => localStorage.clear())
it('persists the local scratch library, prevents duplicates, and never pretends to create cloud shares', async () => {
  const input = {
    title: 'Twisted Fate review',
    youtube_video_id: 'aB3_dE-fG09',
    recorded_on: '2026-11-09',
  }
  await localRepository.add(input)
  const rows = await localRepository.list()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject(input)
  await expect(localRepository.add(input)).rejects.toThrow('already in your library')
  await localRepository.rename(rows[0].id, 'Mid lane review')
  expect((await localRepository.list())[0].title).toBe('Mid lane review')
  await expect(localRepository.share(rows[0].id)).rejects.toThrow('Connect Supabase')
  await localRepository.remove(rows[0].id)
  expect(await localRepository.list()).toEqual([])
})
