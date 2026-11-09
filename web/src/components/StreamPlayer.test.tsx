import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { StreamPlayer, refreshStreamURL } from './StreamPlayer'
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
const xhrSetups: ((xhr: XMLHttpRequest, url: string) => void)[] = []
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() {
      return true
    }
    static Events = { ERROR: 'error' }
    constructor(config: { xhrSetup: (typeof xhrSetups)[number] }) {
      xhrSetups.push(config.xhrSetup)
    }
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy = destroy
  },
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.mocked(streamRequest).mockResolvedValue(lease())
  xhrSetups.length = 0
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
it('renews the lease without rebuilding the player and signs subsequent segment requests', async () => {
  await start()
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
  const xhr = { open: vi.fn() }
  xhrSetups[0](
    xhr as unknown as XMLHttpRequest,
    'https://customer-test.cloudflarestream.com/first/video/720/seg.ts',
  )
  expect(xhr.open).toHaveBeenCalledWith(
    'GET',
    'https://customer-test.cloudflarestream.com/second/video/720/seg.ts',
    true,
  )
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
it('never forwards a renewed token to another host', () => {
  expect(
    refreshStreamURL(
      'https://other.test/first/segment',
      lease().url,
      'https://customer-test.cloudflarestream.com/secret/manifest/video.m3u8',
    ),
  ).toBe('https://other.test/first/segment')
})
