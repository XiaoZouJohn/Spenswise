import { test, expect } from './fixtures'

test('用户中心可导出本人数据、撤销设备并修改密码', async ({ page, browser }) => {
  const apiUrl = 'http://127.0.0.1:18080'
  const me = await page.context().request.get(`${apiUrl}/api/auth/me`)
  expect(me.ok()).toBeTruthy()
  const { user } = await me.json() as { user: { email: string } }
  const other = await browser.newContext()
  try {
    const login = await other.request.post(`${apiUrl}/api/auth/login`, {
      data: { email: user.email, password: 'Playwright-Test-2026!' },
    })
    expect(login.ok()).toBeTruthy()

    await page.goto('/user')
    await expect(page.getByRole('heading', { name: '用户中心' })).toBeVisible()
    await expect(page.getByRole('button', { name: '退出该设备' })).toBeVisible()
    await page.getByRole('button', { name: '退出该设备' }).click()
    await expect(page.getByRole('status')).toContainText('已退出所选设备')
    expect((await other.request.get(`${apiUrl}/api/auth/me`)).status()).toBe(401)

    const downloadPromise = page.waitForEvent('download')
    const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/users/me/export'))
    await page.getByRole('button', { name: '导出个人数据 JSON' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^SpendWise-个人数据-.*\.json$/)
    expect(await download.failure()).toBeNull()
    const payload = await (await exportResponse).json() as { user: { email: string }; data: Record<string, unknown> }
    expect(payload.user.email).toBe(user.email)
    expect(payload.data).toHaveProperty('transactions')

    await page.getByLabel('当前密码').fill('Playwright-Test-2026!')
    await page.getByLabel('新密码', { exact: true }).fill('Playwright-New-2026!')
    await page.getByLabel('再次输入新密码').fill('Playwright-New-2026!')
    await page.getByRole('button', { name: '更新密码' }).click()
    await expect(page.getByRole('status')).toContainText('密码已修改')
    expect((await other.request.post(`${apiUrl}/api/auth/login`, {
      data: { email: user.email, password: 'Playwright-Test-2026!' },
    })).status()).toBe(401)
    expect((await other.request.post(`${apiUrl}/api/auth/login`, {
      data: { email: user.email, password: 'Playwright-New-2026!' },
    })).ok()).toBeTruthy()
  } finally {
    await other.close()
  }
})
