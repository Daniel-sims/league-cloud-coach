import { expect, test, type BrowserContext } from '@playwright/test'
import { changes, match } from '../src/test/league-fixture'
import type { LeagueMatch, LeagueProfile } from '../src/lib/league'
import { readFileSync } from 'node:fs'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const ownerId = '11111111-1111-4111-8111-111111111111'
const blockId = '22222222-2222-4222-8222-222222222222'
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
const games: LeagueMatch[] = [match('EUW1_1'), match('EUW1_2', { win: false, kills: 5, deaths: 6 })]
const legacy = (id: string, win: boolean) => ({
  matchId: id,
  profileId: profile.id,
  championId: 103,
  championName: 'Ahri',
  opponentName: 'Zed',
  kills: 5,
  deaths: 6,
  assists: 22,
  win,
  remake: false,
  queueId: 420,
  gameCreation: Date.UTC(2026, 10, 18),
  gameDuration: 1200,
})
const block = {
  id: blockId,
  title: '',
  carryIn: [],
  games: [
    { id: 'g1', title: '', notes: '', match: legacy('EUW1_1', true) },
    { id: 'g2', title: '', notes: 'Fell behind after level 6', match: legacy('EUW1_2', false) },
  ],
  carryForward: [],
  revision: 1,
  createdAt: '2026-11-18T10:00:00Z',
  updatedAt: '2026-11-18T10:00:00Z',
}

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
  await context.route(
    'https://ddragon.leagueoflegends.com/cdn/*/data/en_US/champion/*.json',
    (route) =>
      route.fulfill({
        json: fixture(`champion-${route.request().url().split('/').at(-1)}`),
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
  await context.route('https://cloud-coach-test.supabase.co/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    let result: unknown = null
    if (name === 'user') result = user
    if (name === 'is_library_owner') result = true
    if (name === 'list_league_profiles') result = [profile]
    if (name === 'list_league_match_changes') result = changes(games)
    if (name === 'list_blocks') result = [block]
    if (name === 'list_match_recordings') result = { EUW1_1: 'rec-1' }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    })
  })
}

const shots = process.env.BLOCK_SHOTS

test('a block shows each game with matchup, stats and its recording', async ({ page }) => {
  await setup(page.context())
  await page.goto('/#/blocks')
  await expect(page.getByText('2 games')).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/blocks-list.png` })
  await page.goto(`/#/blocks/${blockId}`)
  await expect(page.getByText('Fell behind after level 6')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Your team' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Watch VOD' })).toHaveAttribute(
    'href',
    '#/video/rec-1',
  )
  await expect(page.getByText('No VOD')).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/blocks-light.png`, fullPage: true })
  await page.evaluate(() => localStorage.setItem('league-cloud-coach-theme', 'dark'))
  await page.reload()
  await expect(page.getByText('Fell behind after level 6')).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/blocks-dark.png`, fullPage: true })
})
