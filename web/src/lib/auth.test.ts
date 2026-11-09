import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const exchange = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { exchangeCodeForSession: exchange } }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://cloud-coach-test.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key')
  exchange.mockReset()
  history.replaceState(null, '', '/')
})
afterEach(() => vi.unstubAllEnvs())

it('exchanges a PKCE code once and removes it from browser history', async () => {
  history.replaceState(null, '', '/?code=one-time-code')
  exchange.mockResolvedValue({ error: null })
  const { initializeAuth } = await import('./supabase')
  expect(await initializeAuth()).toBeNull()
  expect(exchange).toHaveBeenCalledExactlyOnceWith('one-time-code')
  expect(location.search).toBe('')
  expect(location.hash).toBe('#/library')
  await initializeAuth()
  expect(exchange).toHaveBeenCalledTimes(1)
})

it.each(['/?error=access_denied', '/#error=access_denied&error_description=cancelled'])(
  'handles cancelled sign-in at %s without trusting provider text',
  async (url) => {
    history.replaceState(null, '', url)
    const { initializeAuth } = await import('./supabase')
    expect(await initializeAuth()).toContain('sign-in was cancelled')
    expect(exchange).not.toHaveBeenCalled()
    expect(location.search).toBe('')
    expect(location.hash).toBe('#/library')
  },
)

it('makes an expired or cross-browser PKCE code retryable without leaving it in the URL', async () => {
  history.replaceState(null, '', '/?code=expired')
  exchange.mockResolvedValue({ error: new Error('verifier mismatch') })
  const { initializeAuth } = await import('./supabase')
  expect(await initializeAuth()).toContain('Please sign in again')
  expect(location.search).toBe('')
})
