import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures'

test('注销要求密码并先离开家庭，删除后原会话和数据均不可访问', async ({ page, browser }) => {
  const apiUrl = 'http://127.0.0.1:18080'
  const own = page.context().request
  const me = await own.get(`${apiUrl}/api/auth/me`)
  expect(me.ok()).toBeTruthy()
  const { user } = await me.json() as { user: { email: string } }

  const merchant = `待注销账单-${randomUUID().slice(0, 8)}`
  const transaction = await own.post(`${apiUrl}/api/transactions`, {
    data: {
      tx_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
      amount_cents: 12345,
      tx_type: 'expense',
      merchant,
      category: '餐饮',
    },
  })
  expect(transaction.ok(), await transaction.text()).toBeTruthy()
  const { id } = await transaction.json() as { id: number }

  const family = await own.post(`${apiUrl}/api/families`, {
    data: { name: `注销验收家庭-${randomUUID().slice(0, 8)}` },
  })
  expect(family.ok(), await family.text()).toBeTruthy()

  await page.goto('/user')
  await page.getByRole('button', { name: '注销账号' }).click()
  const dialog = page.getByRole('dialog', { name: '注销账号' })
  await expect(dialog.getByRole('button', { name: '确认永久注销' })).toBeDisabled()
  await dialog.getByLabel('输入当前密码').fill('wrong-password')
  await dialog.getByRole('checkbox', { name: '我确认注销后无法恢复个人数据' }).check()
  const wrongResponse = page.waitForResponse(response => response.url().endsWith('/api/users/me') && response.request().method() === 'DELETE')
  await dialog.getByRole('button', { name: '确认永久注销' }).click()
  expect((await wrongResponse).status()).toBe(403)
  await expect(dialog.getByRole('alert')).toContainText('密码错误')
  expect((await own.get(`${apiUrl}/api/auth/me`)).ok()).toBeTruthy()

  await dialog.getByLabel('输入当前密码').fill('Playwright-Test-2026!')
  const familyResponse = page.waitForResponse(response => response.url().endsWith('/api/users/me') && response.request().method() === 'DELETE')
  await dialog.getByRole('button', { name: '确认永久注销' }).click()
  expect((await familyResponse).status()).toBe(409)
  await expect(dialog.getByRole('alert')).toContainText('请先退出、转让或解散家庭')
  const dissolve = await own.delete(`${apiUrl}/api/families`)
  expect(dissolve.ok(), await dissolve.text()).toBeTruthy()

  const other = await browser.newContext()
  try {
    const otherRegister = await other.request.post(`${apiUrl}/api/auth/register`, {
      data: {
        email: `survivor-${randomUUID()}@example.test`,
        password: 'Playwright-Test-2026!',
        display_name: '保留账号',
      },
    })
    expect(otherRegister.ok(), await otherRegister.text()).toBeTruthy()

    const deletedResponse = page.waitForResponse(response => response.url().endsWith('/api/users/me') && response.request().method() === 'DELETE')
    await dialog.getByRole('button', { name: '确认永久注销' }).click()
    const deleted = await deletedResponse
    expect(deleted.ok(), await deleted.text()).toBeTruthy()
    expect(await deleted.json()).toEqual({ deleted: true })
    expect((await own.get(`${apiUrl}/api/auth/me`)).status()).toBe(401)
    expect((await own.get(`${apiUrl}/api/users/me/export`)).status()).toBe(401)
    const oldLogin = await own.post(`${apiUrl}/api/auth/login`, {
      data: { email: user.email, password: 'Playwright-Test-2026!' },
    })
    expect(oldLogin.status()).toBe(401)

    const deletedBill = await other.request.get(`${apiUrl}/api/transactions?ids=${id}`)
    expect(deletedBill.ok()).toBeTruthy()
    const result = await deletedBill.json() as { total: number; items: { merchant: string }[] }
    expect(result.total).toBe(0)
    expect(result.items).toEqual([])
    expect((await other.request.get(`${apiUrl}/api/auth/me`)).ok()).toBeTruthy()

    await page.goto('/user')
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  } finally {
    await other.close()
  }
})
