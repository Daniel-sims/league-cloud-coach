import { expect, test, type BrowserContext } from '@playwright/test'
import { changes, match } from '../src/test/league-fixture'
import type { LeagueMatch, LeagueProfile } from '../src/lib/league'
import { readFileSync } from 'node:fs'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

const ownerId = '11111111-1111-4111-8111-111111111111'
const profile: LeagueProfile = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  platform: 'euw1',
  puuid: 'me',
  gameName: 'Test Player',
  tagLine: 'EUW',
  profileIconId: 1,
  summonerLevel: 120,
  ranks: [],
  syncedAt: '2026-11-10T00:00:00Z',
}
// Ahri (103) into Zed (238) twelve times, plus a few other lanes.
const results = [true, false, true, true, false, true, false, true, true, false, true, true]
const games: LeagueMatch[] = [
  ...results.map((win, i) =>
    match(
      `EUW1_${i + 1}`,
      { win, kills: win ? 7 : 2, deaths: win ? 2 : 6 },
      { gameDuration: 1500 + i * 60 },
    ),
  ),
  ...[13, 14, 15].map((n) => {
    const m = match(`EUW1_${n}`, { win: n !== 14 })
    m.participants[2] = { ...m.participants[2], championId: 134, championName: 'Syndra' }
    return m
  }),
]
games[0].participants[0].perks = {
  statPerks: { offense: 5008, flex: 5008, defense: 5011 },
  styles: [
    { style: 8100, selections: [{ perk: 8112 }, { perk: 8126 }, { perk: 8138 }, { perk: 8135 }] },
    { style: 8200, selections: [{ perk: 8226 }, { perk: 8237 }] },
  ],
} as never
// Deterministic lane curves: wins pull ahead, losses fall behind. Game 12 has no timeline.
const lanes = Object.fromEntries(
  results.slice(0, 11).map((win, i) => [
    `EUW1_${i + 1}`,
    Array.from({ length: 26 + i }, (_, minute) => {
      const swing = (win ? 1 : -1) * minute * (40 + ((i * 37) % 60)) + Math.sin(minute + i) * 120
      return [
        minute * 60 + 3,
        Math.round(minute < 2 ? 0 : swing),
        Math.round(swing / 45),
        Math.round(swing / 2),
      ]
    }),
  ]),
)

async function setup(context: BrowserContext) {
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
  await context.route(
    'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk*.json',
    (route) =>
      route.fulfill({
        json: fixture(
          route.request().url().endsWith('perks.json') ? 'perks.json' : 'perkstyles.json',
        ),
      }),
  )
  await context.route('https://ddragon.leagueoflegends.com/api/versions.json', (route) =>
    route.fulfill({ json: ['16.22.1'] }),
  )
  await context.route(
    'https://ddragon.leagueoflegends.com/cdn/*/data/en_US/champion.json',
    (route) =>
      route.fulfill({
        json: {
          data: {
            Ahri: { key: '103', name: 'Ahri' },
            Zed: { key: '238', name: 'Zed' },
            Syndra: { key: '134', name: 'Syndra' },
            Sylas: { key: '517', name: 'Sylas' },
            LeeSin: { key: '64', name: 'Lee Sin' },
            Jinx: { key: '222', name: 'Jinx' },
            TwistedFate: { key: '4', name: 'Twisted Fate' },
          },
        },
      }),
  )
  const saved: Record<string, unknown>[] = []
  await context.route('https://cloud-coach-test.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    const args = route.request().postDataJSON() || {}
    let result: unknown = null
    if (name === 'user') result = user
    if (name === 'is_library_owner') result = true
    if (name === 'list_league_profiles') result = [profile]
    if (name === 'list_league_match_changes') result = changes(games)
    if (name === 'list_matchups') result = saved
    if (name === 'list_matchup_lanes') result = lanes
    if (name === 'save_matchup') {
      result = {
        ...args.p_note,
        championId: args.p_champion,
        opponentId: args.p_opponent,
        revision: args.p_revision + 1,
      }
      saved.splice(0, saved.length, result as Record<string, unknown>)
    }
    if (name === 'list_match_recordings') result = {}
    if (name === 'riot')
      result =
        args.action === 'live-game'
          ? {
              inGame: true,
              queueId: 420,
              gameStartTime: Date.now() - 4 * 60000,
              championId: 103,
              allies: [{ championId: 103, spells: [4, 14] }],
              enemies: [
                { championId: 64, spells: [4, 11] },
                { championId: 238, spells: [4, 14] },
                { championId: 222, spells: [4, 7] },
                { championId: 134, spells: [4, 12] },
                { championId: 4, spells: [4, 3] },
              ],
            }
          : { ok: true }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}

const shots = process.env.MATCHUP_SHOTS

test('pick a matchup, write notes, then read the lane stats', async ({ page }, testInfo) => {
  await setup(page.context())
  await page.goto('/#/matchups')
  await expect(page.getByRole('heading', { name: 'Matchups', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'You' })).toHaveValue('Ahri')
  await expect(page.getByTitle('Ahri vs Zed')).toBeVisible()
  await expect(page.getByText('In game')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Zed/ })).toHaveAttribute('aria-checked', 'true')
  if (shots) await page.screenshot({ path: `${shots}/matchups-home.png`, fullPage: true })

  await page.getByRole('combobox', { name: 'Lane opponent' }).fill('ze')
  await expect(page.getByRole('option', { name: 'Zed' })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /Open matchup/ }).click()
  await expect(page).toHaveURL(/#\/matchups\/103\/238$/)
  await expect(page.getByRole('textbox', { name: 'Game plan' })).toBeVisible()

  await page
    .getByRole('textbox', { name: 'Game plan' })
    .fill('Respect level 6: hold Charm for his W shadow')
  await page.getByRole('radio', { name: 'Hard' }).click()
  await page.getByRole('button', { name: 'Add point' }).first().click()
  await page.keyboard.type('Death Mark + Ignite kills from 60%')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Shadow swap after you Flash')
  await page.getByRole('button', { name: 'Add point' }).nth(1).click()
  await page.keyboard.type('Push waves under tower pre-6')
  // Rune page: primary path, keystone with its tooltip, then a secondary path.
  await page.getByRole('button', { name: 'Primary path: Precision' }).click()
  const keystone = page.getByRole('button', { name: 'Conqueror' })
  // Tooltips close on scroll, so scroll first and hover once the page is still.
  await page.locator('.rune-page').scrollIntoViewIfNeeded()
  await keystone.hover()
  await expect(page.getByRole('tooltip')).toContainText('Conqueror')
  await expect(page.getByRole('tooltip')).toContainText('Hold Shift for details')
  await page.keyboard.down('Shift')
  await expect(page.getByRole('tooltip')).not.toContainText('Hold Shift for details')
  await page.keyboard.up('Shift')
  await keystone.click()
  await expect(keystone).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Triumph' }).click()
  await page.getByRole('button', { name: 'Legend: Alacrity' }).click()
  await page.getByRole('button', { name: 'Last Stand' }).click()
  await page.getByRole('button', { name: 'Secondary path: Resolve' }).click()
  await page.getByRole('button', { name: 'Second Wind' }).click()
  await page.getByRole('button', { name: 'Overgrowth' }).click()
  await page
    .getByRole('group', { name: 'Offense shard' })
    .getByRole('button', { name: 'Attack Speed' })
    .click()
  await page
    .getByRole('group', { name: 'Flex shard' })
    .getByRole('button', { name: 'Adaptive Force' })
    .click()
  await page
    .getByRole('group', { name: 'Defense shard' })
    .getByRole('button', { name: 'Health', exact: true })
    .click()
  await page.mouse.move(0, 0)
  if (shots) {
    await page.locator('.rune-page').scrollIntoViewIfNeeded()
    await page.locator('.rune-page').screenshot({ path: `${shots}/rune-page.png` })
    await page.getByRole('button', { name: 'Fleet Footwork' }).hover()
    await page.screenshot({ path: `${shots}/rune-tooltip.png` })
    await page.mouse.move(0, 0)
    await page.getByRole('button', { name: 'Names and descriptions' }).click()
    await page.locator('.rune-page').screenshot({ path: `${shots}/rune-detailed.png` })
    await page.getByRole('button', { name: 'Icons only' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.rune-page').screenshot({ path: `${shots}/rune-mobile.png` })
    await page.setViewportSize({ width: 1280, height: 720 })
  }
  // Copy the page from a game in this matchup.
  await page.getByRole('combobox', { name: 'Copy runes from a game' }).selectOption({ index: 1 })
  await expect(page.getByRole('button', { name: 'Electrocute' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Primary path: Domination' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/matchup-notes.png`, fullPage: true })

  await page
    .getByRole('navigation', { name: 'Matchup sections' })
    .getByRole('link', { name: /Stats/ })
    .click()
  await expect(page).toHaveURL(/\/stats$/)
  await expect(page.getByText('Win rate')).toBeVisible()
  await expect(page.getByText('8W 4L · 12 games')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Last 5 results, newest first/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Gold difference by minute/ })).toBeVisible()
  await expect(page.getByText(/Lane charts use 11 of 12 games/)).toBeVisible()
  const chart = page.getByRole('img', { name: /Gold difference by minute/ })
  const box = (await chart.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2)
  await expect(page.locator('.chart-tooltip')).toContainText('Minute')
  if (shots) await page.screenshot({ path: `${shots}/matchup-stats.png`, fullPage: true })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  if (shots) await page.screenshot({ path: `${shots}/matchup-stats-dark.png`, fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  if (shots) await page.screenshot({ path: `${shots}/matchup-stats-mobile.png`, fullPage: true })
  // Back on the Matchup tab, the notes written earlier are still there.
  await page
    .getByRole('navigation', { name: 'Matchup sections' })
    .getByRole('link', { name: 'Matchup' })
    .click()
  await expect(page.getByRole('textbox', { name: 'Game plan' })).toHaveValue(
    'Respect level 6: hold Charm for his W shadow',
  )
  if (shots) await page.screenshot({ path: `${shots}/matchup-notes-mobile.png`, fullPage: true })
  testInfo.annotations.push({ type: 'matchups', description: 'ok' })
})
