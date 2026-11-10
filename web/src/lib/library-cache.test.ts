import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  clearLibraryCaches,
  selectLibraryCacheAccount,
  invalidateLibraryCache,
  libraryCacheEpoch,
  readLibraryCache,
  saveLibraryCache,
} from './library-cache'
import type { Recording } from './types'
const record: Recording = {
  id: 'owned',
  title: 'Saved game',
  youtube_video_id: null,
  provider: 'stream',
  stream_video_id: 'd'.repeat(32),
  recorded_on: null,
  created_at: '2026-11-10T12:00:00Z',
  has_share: false,
}
beforeEach(() => {
  clearLibraryCaches()
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())
it('restores bounded display metadata per owner and strips unexpected credentials', () => {
  saveLibraryCache('owner-a', [{ ...record, unexpectedToken: 'never-store-this' } as Recording])
  expect(readLibraryCache('owner-a')).toEqual([record])
  expect(readLibraryCache('owner-b')).toBeNull()
  expect(JSON.stringify(Object.values(localStorage))).not.toContain('never-store-this')
  saveLibraryCache('owner-b', [])
  expect(readLibraryCache('owner-b')).toEqual([])
})
it('rejects expired or corrupt cached data without breaking the library', () => {
  saveLibraryCache('owner', [record])
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 8 * 24 * 60 * 60 * 1000)
  expect(readLibraryCache('owner')).toBeNull()
  expect(() => readLibraryCache(undefined)).not.toThrow()
})
it('does not allow stale requests to restore metadata after mutation or sign-out', () => {
  const beforeMutation = libraryCacheEpoch()
  saveLibraryCache('owner', [record])
  invalidateLibraryCache('owner')
  saveLibraryCache('owner', [record], beforeMutation)
  expect(readLibraryCache('owner')).toBeNull()
  const beforeSignOut = libraryCacheEpoch()
  clearLibraryCaches()
  saveLibraryCache('owner', [record], beforeSignOut)
  expect(readLibraryCache('owner')).toBeNull()
})
it('keeps a memory cache when browser storage is full or disabled', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota exceeded')
  })
  expect(() => saveLibraryCache('owner', [record])).not.toThrow()
  expect(readLibraryCache('owner')).toEqual([record])
})

it('ignores malformed persisted rows instead of rendering corrupt titles', () => {
  saveLibraryCache('owner', [record])
  const key = Object.keys(localStorage).find((k) => k.endsWith(':owner'))!
  localStorage.setItem(
    key.slice(0, -5) + 'corrupt',
    JSON.stringify({ savedAt: Date.now(), records: [{ ...record, title: 42 }] }),
  )
  expect(readLibraryCache('corrupt')).toBeNull()
})

it('keeps the same account snapshot and clears it when another account restores a session', () => {
  selectLibraryCacheAccount('owner-a')
  saveLibraryCache('owner-a', [record])
  selectLibraryCacheAccount('owner-a')
  expect(readLibraryCache('owner-a')).toEqual([record])
  selectLibraryCacheAccount('owner-b')
  expect(readLibraryCache('owner-a')).toBeNull()
  expect(readLibraryCache('owner-b')).toBeNull()
})
