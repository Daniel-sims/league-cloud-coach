import { expect, test, type BrowserContext } from '@playwright/test'
import { match } from '../src/test/league-fixture'
import type { LeagueProfile, LeagueMatch } from '../src/lib/league'

const ownerId = '11111111-1111-4111-8111-111111111111'
const profile: LeagueProfile = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  platform: 'euw1',
  puuid: 'me',
  gameName: 'Test Player',
  tagLine: 'EUW',
  profileIconId: 1,
  summonerLevel: 120,
  ranks: [
    {
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      rank: 'II',
      leaguePoints: 56,
      wins: 12,
      losses: 8,
    },
  ],
  syncedAt: '2026-11-10T00:00:00Z',
}
const lookedUp = {
  gameName: 'Zed Main',
  tagLine: 'EUW',
  profileIconId: 4,
  summonerLevel: 210,
  ranks: [],
}
async function setup(
  context: BrowserContext,
  empty = false,
  tokenWarning = false,
  games?: LeagueMatch[],
) {
  const user = {
    id: ownerId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.test',
    app_metadata: { provider: 'google' },
    user_metadata: { full_name: 'Test Owner' },
    created_at: '2026-11-09T00:00:00Z',
  }
  const expires = Math.floor(Date.now() / 1000) + 3600
  await context.addInitScript(
    ({ user, expires }) =>
      localStorage.setItem(
        'sb-cloud-coach-test-auth-token',
        JSON.stringify({
          access_token: `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' }))}.test`,
          refresh_token: 'test-refresh-token',
          token_type: 'bearer',
          expires_at: expires,
          expires_in: 3600,
          user,
        }),
      ),
    { user, expires },
  )
  let profiles = empty ? [] : [profile]
  await context.route('https://cloud-coach-test.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    const args = route.request().postDataJSON() || {}
    let result: unknown = null
    if (name === 'user') result = user
    if (name === 'is_library_owner') result = true
    if (name === 'list_league_profiles') result = profiles
    if (name === 'list_league_matches')
      result = games ?? [
        match('1'),
        match('2', { win: false }),
        match('3', { championId: 222, championName: 'Jinx', teamPosition: 'BOTTOM' }),
      ]
    if (name === 'riot') {
      if (args.action === 'token-status') result = { configured: false, sharedDefault: false }
      else if (args.action === 'save-token')
        result = {
          ok: true,
          verified: !tokenWarning,
          ...(tokenWarning
            ? {
                warning:
                  'Token saved. If you just generated it, it may take a few minutes to start working.',
              }
            : {}),
        }
      else if (args.action === 'remove-token') result = { ok: true }
      else if (args.action === 'find-player')
        result = { puuid: 'enemy-puuid-0000000000', profile: lookedUp }
      else if (args.action === 'view-player') result = { profile: lookedUp }
      else if (args.action === 'view-matches') {
        const game = match('9', { puuid: 'enemy-puuid-0000000000', championName: 'Zed' })
        game.participants[1] = { ...game.participants[1], puuid: 'me', championName: 'Ahri' }
        result = { ids: ['9'], matches: [game], nextStart: 5, hasMore: false }
      } else if (args.action === 'connect') {
        profiles = [profile]
        result = { id: profile.id }
      } else if (args.action === 'refresh-profile') result = { ok: true }
      else result = { nextStart: 3, hasMore: false }
    }
    if (name === 'list_recordings') result = []
    if (name === 'stream') result = { imported: 0, pending: [] }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}
test('home loads stats, champion and result filters, scoreboard, and keeps the video library reachable', async ({
  page,
}, testInfo) => {
  await setup(page.context())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Home.' })).toBeVisible()
  await expect(page.getByLabel('League account')).toHaveValue(profile.id)
  await expect(page.getByText('67% win rate · 2W – 1L')).toBeVisible()
  await page.getByLabel('Your champion').selectOption('103')
  await expect(page.getByText('50% win rate · 1W – 1L')).toBeVisible()
  await page.getByLabel('Result', { exact: true }).selectOption('loss')
  await expect(page.getByRole('button', { name: /Scoreboard for/ })).toHaveCount(1)
  await page.getByRole('button', { name: /Scoreboard for 2/ }).click()
  await expect(page.getByText('Defeat · Blue team')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Damage' })).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true })
  await page.getByRole('link', { name: /Video library/ }).click()
  await expect(page.getByRole('button', { name: 'Upload your first video' })).toBeVisible()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recent games' })).toBeVisible()
})
test('settings lets the owner save a masked Riot token and sign-out requires confirmation', async ({
  page,
}) => {
  await setup(page.context())
  let signOutCalls = 0
  await page.route('**/auth/v1/logout*', async (route) => {
    signOutCalls++
    await route.fulfill({ status: 204 })
  })
  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(settings.getByText('No Riot token saved yet.')).toBeVisible()
  const input = settings.getByLabel('Riot API token')
  await expect(input).toHaveAttribute('type', 'password')
  await input.fill('RGAPI-' + 'a'.repeat(36))
  await settings.getByRole('button', { name: 'Save token' }).click()
  await expect(settings.getByText('Riot token saved and verified.')).toBeVisible()
  await expect(input).toHaveValue('')
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Sign out?', exact: true })
  await expect(confirmation).toBeVisible()
  expect(signOutCalls).toBe(0)
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmation).not.toBeVisible()
  expect(signOutCalls).toBe(0)
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  expect(signOutCalls).toBe(1)
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).not.toBeVisible()
})
test('mobile home connects an account with keyboard access and fits the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page.context(), true)
  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Choose your League account' }).click()
  await expect(page.getByLabel('Riot ID')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Choose your League account' })).toBeFocused()
  await page.getByRole('button', { name: 'Choose your League account' }).click()
  await page.getByLabel('Riot ID').fill('Test Player#EUW')
  await page.getByRole('button', { name: 'Add account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recent games' })).toBeVisible()
  await expect(page.getByText('67% win rate · 2W – 1L')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.getByRole('button', { name: /Scoreboard for 1/ }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('home-mobile.png'), fullPage: true })
})
test('a newly generated Riot token is saved with a warning while verification is pending', async ({
  page,
}) => {
  await setup(page.context(), false, true)
  await page.goto('/#/home')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByLabel('Riot API token').fill('RGAPI-' + 'a'.repeat(36))
  await settings.getByRole('button', { name: 'Save token' }).click()
  await expect(settings.getByRole('status')).toContainText('a few minutes')
  await expect(settings.getByText('A personal Riot token is saved.')).toBeVisible()
  await expect(settings.getByLabel('Riot API token')).toHaveValue('')
  await expect(settings.getByRole('alert')).toHaveCount(0)
})

test('Settings stays at the bottom and appearance switches immediately and survives reload', async ({
  page,
}, testInfo) => {
  await setup(page.context())
  await page.goto('/#/home')
  await expect(page.getByRole('heading', { name: 'Recent games' })).toBeVisible()
  const sidebar = await page.getByRole('complementary').boundingBox()
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  const settingsBox = await settings.boundingBox()
  expect(settingsBox!.y).toBeGreaterThan(sidebar!.y + sidebar!.height * 0.6)
  await settings.click()
  const toggle = page.getByRole('switch', { name: 'Dark mode', exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(35, 43, 37)')
  await page.screenshot({ path: testInfo.outputPath('dark-settings-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await settings.click()
  await expect(toggle).toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('dark-settings-mobile.png'), fullPage: true })
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(251, 250, 246)')
})

test('match history groups local play dates and selector arrows stay inset in both themes', async ({
  page,
}, testInfo) => {
  await setup(page.context(), false, false, [
    match('1', {}, { gameCreation: Date.UTC(2026, 10, 11, 18) }),
    match('2', {}, { gameCreation: Date.UTC(2026, 10, 11, 12) }),
    match('3', { win: false }, { gameCreation: Date.UTC(2026, 10, 10, 12) }),
  ])
  await page.goto('/#/home')
  const history = page.getByRole('region', { name: 'Match history', exact: true })
  await expect(history.getByRole('heading', { level: 3 })).toHaveText([
    'Wednesday, 11 November 2026',
    'Tuesday, 10 November 2026',
  ])
  const champion = page.getByLabel('Your champion', { exact: true })
  expect(await champion.evaluate((el) => getComputedStyle(el).backgroundPosition)).toContain('12px')
  await expect(champion).toHaveCSS('padding-right', '36px')
  await history.screenshot({ path: testInfo.outputPath('grouped-games-light.png') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('switch', { name: 'Dark mode', exact: true }).check()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  expect(await champion.evaluate((el) => getComputedStyle(el).backgroundPosition)).toContain('12px')
  expect(await champion.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('a8b2a3')
  await history.screenshot({ path: testInfo.outputPath('grouped-games-dark.png') })
  await page.getByLabel('Sort', { exact: true }).selectOption('oldest')
  await expect(history.getByRole('heading', { level: 3 })).toHaveText([
    'Tuesday, 10 November 2026',
    'Wednesday, 11 November 2026',
  ])
  await page.getByLabel('Result', { exact: true }).selectOption('win')
  await expect(history.getByRole('heading', { level: 3 })).toHaveText([
    'Wednesday, 11 November 2026',
  ])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})

test('summoners looks anyone up, opens scoreboard players there, and keeps Home for you', async ({
  page,
}, testInfo) => {
  await setup(page.context())
  await page.goto('/')
  await page.getByRole('link', { name: 'Summoners', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Summoners.' })).toBeVisible()
  await expect(page.getByText('No one looked up yet')).toBeVisible()
  await page.getByLabel('Riot ID').fill('Zed Main#EUW')
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByRole('heading', { name: 'Zed Main#EUW.' })).toBeVisible()
  await page.getByRole('button', { name: /Scoreboard for 9/ }).click()
  await page.screenshot({ path: testInfo.outputPath('summoner-desktop.png'), fullPage: true })
  await page.getByTitle("Open Ahri's profile").first().click()
  await expect(page.getByRole('heading', { name: 'Home.' })).toBeVisible()
  // From Home, a scoreboard player opens on the Summoners page.
  await page.getByRole('button', { name: /Scoreboard for 1/ }).click()
  await page.getByTitle("Open Zed's profile").first().click()
  await expect(page).toHaveURL(/#\/summoners\/euw1\/enemy/)
  await page.getByRole('link', { name: 'Summoners', exact: true }).first().click()
  await expect(page.getByRole('link', { name: /Zed Main#EUW/ })).toBeVisible()
})
