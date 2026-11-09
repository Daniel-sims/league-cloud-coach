import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { StreamPlayer } from './StreamPlayer'
import { streamRequest, StreamAccessError } from '../lib/supabase'
vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase')>()
  return { ...actual, streamRequest: vi.fn(), viewerSession: () => 'b'.repeat(64) }
})
const lease = () => ({
  url: 'https://customer-test.cloudflarestream.com/first/manifest/video.m3u8',
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  sessionExpiresAt: new Date(Date.now() + 7200000).toISOString(),
})
const destroy = vi.fn()
const loadSource = vi.fn()
const configs: { startPosition?: number }[] = []
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() {
      return true
    }
    static Events = { ERROR: 'error' }
    config: { startPosition?: number }
    constructor(config: { startPosition?: number }) {
      this.config = config
      configs.push(config)
    }
    on() {}
    loadSource = loadSource
    attachMedia() {}
    destroy = destroy
  },
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.mocked(streamRequest).mockResolvedValue(lease())
  configs.length = 0
  loadSource.mockClear()
  destroy.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
async function start() {
  render(<StreamPlayer shareToken={'a'.repeat(64)} title="Private game" />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  })
}
it('does not claim or fetch media until the viewer explicitly starts', async () => {
  vi.mocked(streamRequest).mockClear()
  render(<StreamPlayer shareToken={'a'.repeat(64)} title="Private game" />)
  expect(streamRequest).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Private game')).not.toBeInTheDocument()
})
it('reloads fresh segment signatures while preserving playback position on renewal', async () => {
  await start()
  const media = screen.getByLabelText('Private game') as HTMLVideoElement
  media.currentTime = 95
  vi.mocked(streamRequest).mockResolvedValue({
    ...lease(),
    url: 'https://customer-test.cloudflarestream.com/second/manifest/video.m3u8',
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(240000)
  })
  expect(streamRequest).toHaveBeenLastCalledWith('renew', {
    token: 'a'.repeat(64),
    session: 'b'.repeat(64),
  })
  expect(loadSource).toHaveBeenLastCalledWith(
    'https://customer-test.cloudflarestream.com/second/manifest/video.m3u8',
  )
  expect(configs[0].startPosition).toBe(95)
  media.currentTime = 0
  fireEvent.loadedMetadata(media)
  expect(media.currentTime).toBe(95)
  expect(destroy).not.toHaveBeenCalled()
})
it('unloads media when a revoked share cannot renew', async () => {
  await start()
  vi.mocked(streamRequest).mockRejectedValue(
    new StreamAccessError('Ask the owner for a new link.', 410),
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(240000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent('Ask the owner for a new link.')
  expect(destroy).toHaveBeenCalled()
})
it('unloads media at the absolute session deadline', async () => {
  vi.mocked(streamRequest).mockResolvedValue({
    ...lease(),
    sessionExpiresAt: new Date(Date.now() + 2000).toISOString(),
  })
  await start()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent('two-hour session has ended')
  expect(destroy).toHaveBeenCalled()
})
it('does not repeatedly renew a lease that already reaches the session deadline', async () => {
  const end = new Date(Date.now() + 200000).toISOString()
  vi.mocked(streamRequest).mockClear()
  vi.mocked(streamRequest).mockResolvedValue({ ...lease(), expiresAt: end, sessionExpiresAt: end })
  await start()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(190000)
  })
  expect(streamRequest).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent('two-hour session has ended')
})
