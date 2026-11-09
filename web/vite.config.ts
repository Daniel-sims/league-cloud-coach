import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    ...(mode === 'test' ? { server: { fs: { allow: ['..'] } } } : {}),
    base: env.VITE_BASE_PATH || '/',
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', '../supabase/functions/**/*.test.ts'],
      restoreMocks: true,
    },
  }
})
