import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const executablePath =
  process.env.PLAYWRIGHT_CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined)

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://cloud-coach-test.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    },
  },
})
