import { randomUUID } from 'node:crypto'
import { test as base, expect } from '@playwright/test'

const apiUrl = 'http://127.0.0.1:18080'

// A unique registered user per test keeps browser cases independent.
export const test = base.extend({
  page: async ({ page, context }, use) => {
    // Local workflow tests must not wait on optional external fonts.
    await context.route('https://fonts.googleapis.com/**', route => route.abort())
    await context.route('https://fonts.gstatic.com/**', route => route.abort())
    const response = await context.request.post(`${apiUrl}/api/auth/register`, {
      data: {
        email: `browser-${randomUUID()}@example.test`,
        password: 'Playwright-Test-2026!',
        display_name: '测试用户',
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    await use(page)
  },
})

export { expect }
export type { Page } from '@playwright/test'
