import { expect, test } from '@playwright/test'

test('local library supports add, reload, search, playback navigation, rename, and removal', async ({
  page,
}) => {
  await page.goto('/#/preview')
  await expect(page.getByRole('heading', { name: 'Your next review starts here' })).toBeVisible()
  await page.getByRole('button', { name: 'Add your first video' }).click()
  await page.getByLabel('YouTube link', { exact: true }).fill('https://youtu.be/aqz-KE-bpKQ')
  await page.getByLabel('Title', { exact: true }).fill('Twisted Fate · review with coach')
  await page.getByRole('dialog').getByRole('button', { name: 'Add video', exact: true }).click()
  await expect(
    page.getByRole('link', { name: 'Twisted Fate · review with coach', exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('searchbox').fill('missing game')
  await expect(page.getByRole('heading', { name: 'No games found' })).toBeVisible()
  await page.getByRole('searchbox').clear()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByLabel('YouTube link', { exact: true })).toHaveValue(
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  )
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('link', { name: 'Twisted Fate · review with coach', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Twisted Fate · review with coach' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  )
  await page.getByRole('link', { name: 'Back to library' }).click()
  await page.getByLabel('More actions for Twisted Fate · review with coach').click()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Reviewed game')
  await page.getByRole('button', { name: 'Save title' }).click()
  await expect(page.getByRole('link', { name: 'Reviewed game', exact: true })).toBeVisible()
  await page.getByLabel('More actions for Reviewed game').click()
  await page.getByRole('button', { name: 'Remove from library', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove from library', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Your next review starts here' })).toBeVisible()
})

test('mobile layout fits and dialog can be operated with keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/preview')
  await expect(page.getByRole('heading', { name: 'Video library.' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
  await page.getByRole('button', { name: 'Add your first video' }).click()
  await expect(page.getByLabel('YouTube link', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Add your first video' })).toBeFocused()
})

test('a malformed public link needs no login and shows a clear unavailable state', async ({
  page,
}) => {
  await page.goto('/#/watch/not-a-token')
  await expect(page.getByRole('heading', { name: 'This game isn’t shared here.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
})
