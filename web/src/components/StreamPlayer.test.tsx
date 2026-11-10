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
it('loads owner playback without claiming a guest session or requiring an extra action', async () => {
  vi.mocked(streamRequest).mockClear()
  await act(async () => {
    render(<StreamPlayer recordingId="owner-recording" title="My recording" />)
  })
  expect(streamRequest).toHaveBeenCalledExactlyOnceWith('owner', { recordingId: 'owner-recording' })
  expect(screen.getByLabelText('My recording')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument()
})
it('shows loading until media is ready and again when playback buffers', async () => {
  await start()
  const media = screen.getByLabelText('Private game')
  expect(screen.getByText('Loading video…')).toBeInTheDocument()
  fireEvent.loadedMetadata(media)
  expect(screen.getByText('Loading video…')).toBeInTheDocument()
  fireEvent.canPlay(media)
  expect(screen.queryByText('Loading video…')).not.toBeInTheDocument()
  fireEvent.waiting(media)
  expect(screen.getByText('Loading video…')).toBeInTheDocument()
  fireEvent.playing(media)
  expect(screen.queryByText('Loading video…')).not.toBeInTheDocument()
  fireEvent.waiting(media)
  fireEvent.error(media)
  expect(screen.queryByText('Loading video…')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Video playback failed')
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
it('seeks by 1, 10 or 30 seconds in both directions and overrides native arrow defaults', async () => {
  await start()
  const media = screen.getByLabelText('Private game') as HTMLVideoElement
  Object.defineProperty(media, 'duration', { configurable: true, value: 180 })
  Object.defineProperty(media, 'readyState', { configurable: true, value: 1 })
  fireEvent.loadedMetadata(media)
  media.currentTime = 90
  expect(fireEvent.keyDown(media, { key: 'ArrowRight' })).toBe(false)
  expect(media.currentTime).toBe(91)
  fireEvent.keyDown(media, { key: 'ArrowLeft' })
  expect(media.currentTime).toBe(90)
  fireEvent.keyDown(media, { key: 'ArrowRight', shiftKey: true })
  expect(media.currentTime).toBe(100)
  fireEvent.keyDown(media, { key: 'ArrowLeft', shiftKey: true })
  expect(media.currentTime).toBe(90)
  media.playbackRate = 2
  fireEvent.keyDown(media, { key: 'ArrowRight', ctrlKey: true })
  expect(media.currentTime).toBe(120)
  fireEvent.keyDown(media, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true })
  expect(media.currentTime).toBe(90)
  fireEvent.keyDown(media, { key: 'ArrowRight', metaKey: true })
  expect(media.currentTime).toBe(90)
  fireEvent.keyDown(media, { key: 'ArrowLeft', altKey: true })
  expect(media.currentTime).toBe(90)
  media.currentTime = 2
  fireEvent.keyDown(media, { key: 'ArrowLeft', ctrlKey: true })
  expect(media.currentTime).toBe(0)
  media.currentTime = 179
  fireEvent.keyDown(media, { key: 'ArrowRight', ctrlKey: true })
  expect(media.currentTime).toBe(180)
})
it('leaves unready media alone and accepts seek shortcuts from the visible seek buttons', async () => {
  await start()
  const media = screen.getByLabelText('Private game') as HTMLVideoElement
  media.currentTime = 50
  expect(fireEvent.keyDown(media, { key: 'ArrowRight' })).toBe(true)
  expect(media.currentTime).toBe(50)
  Object.defineProperty(media, 'duration', { configurable: true, value: 180 })
  Object.defineProperty(media, 'readyState', { configurable: true, value: 1 })
  fireEvent.loadedMetadata(media)
  const forward = screen.getByRole('button', { name: 'Forward 1 second' })
  fireEvent.keyDown(forward, { key: 'ArrowRight', ctrlKey: true })
  expect(media.currentTime).toBe(80)
  fireEvent.click(forward)
  expect(media.currentTime).toBe(81)
  fireEvent.click(screen.getByRole('button', { name: 'Back 30 seconds' }))
  expect(media.currentTime).toBe(51)
  const play = vi.spyOn(media, 'play').mockResolvedValue()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(play).toHaveBeenCalledOnce()
  fireEvent.play(media)
  const pause = vi.spyOn(media, 'pause').mockImplementation(() => {})
  Object.defineProperty(media, 'paused', { configurable: true, value: false })
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(pause).toHaveBeenCalled()
})
