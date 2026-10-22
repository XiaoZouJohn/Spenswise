import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// Every run gets its own database. Never point browser tests at spendwise-dev.db.
const runId = randomUUID().replaceAll('-', '')
const backendDir = resolve('..', 'backend')
const python = process.env.SPENDWISE_TEST_PYTHON || resolve(backendDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const backendUrl = 'http://127.0.0.1:18080'
const frontendUrl = 'http://127.0.0.1:5174'

process.env.NO_PROXY = [...new Set([...(process.env.NO_PROXY || '').split(',').filter(Boolean), '127.0.0.1', 'localhost'])].join(',')

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: frontendUrl,
    ...(process.env.PLAYWRIGHT_USE_SYSTEM_CHROME ? { channel: 'chrome' } : {}),
  },
  webServer: [
    {
      command: `"${python}" -m alembic upgrade head && "${python}" -m uvicorn app.main:app --host 127.0.0.1 --port 18080`,
      cwd: backendDir,
      env: {
        DATABASE_URL: `sqlite:///./spendwise-playwright-${runId}.db`,
        CORS_ORIGINS: frontendUrl,
        CELERY_ALWAYS_EAGER: '1',
        UPLOAD_DIR: `./uploads/playwright-${runId}`,
        AI_KEY_FILE: `./uploads/playwright-${runId}/fernet.key`,
      },
      url: `${backendUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `"${process.execPath}" ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort`,
      env: { VITE_API_URL: backendUrl },
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
