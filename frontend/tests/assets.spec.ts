import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures'

test('共有资产快照和估值有效期更改需要重新确认家庭覆盖', async ({ page }) => {
  const apiUrl = 'http://127.0.0.1:18080'
  const created = await page.context().request.post(`${apiUrl}/api/families`, {
    data: { name: `资产验收家庭-${randomUUID().slice(0, 8)}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()

  await page.goto('/accounts')
  await expect(page.getByRole('heading', { name: '账户与资产' })).toBeVisible()
  await expect(page.getByLabel('估值有效期（天）')).toHaveValue('30')
  await page.getByRole('button', { name: '添加账户或资产' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('名称').fill('共同生活账户')
  await dialog.getByRole('combobox', { name: '个人或共有' }).click()
  await page.getByRole('option', { name: '共有' }).click()
  await dialog.getByLabel('共同约定的账户代号').fill('living-account')
  await expect(dialog.getByText('不要填写银行卡号等敏感信息。', { exact: false })).toBeVisible()
  await dialog.getByRole('spinbutton', { name: '当前金额' }).fill('1000')
  await dialog.getByRole('checkbox', { name: '纳入家庭财富统计' }).check()
  await dialog.getByRole('checkbox', { name: '这是可用于现金流起点的现金账户' }).check()
  await expect(dialog.getByText('如其他成员也录入此共有账户', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: '保存快照' }).click()
  await expect(page.getByRole('heading', { name: '共同生活账户' })).toBeVisible()
  await expect(page.getByText('共有', { exact: true })).toBeVisible()
  await expect(page.getByText('共同代号：living-account')).toBeVisible()

  await page.getByRole('button', { name: '确认纳入范围已完整' }).click()
  await expect(page.getByText('已确认覆盖')).toBeVisible()
  await page.goto('/family')
  await expect(page.getByText(/已覆盖财富/)).toBeVisible()

  await page.goto('/accounts')
  await page.getByLabel('估值有效期（天）').fill('7')
  await page.getByRole('button', { name: '保存有效期' }).click()
  await expect(page.getByText('估值有效期已更新，请重新确认覆盖范围')).toBeVisible()
  await expect(page.getByText('尚未确认覆盖')).toBeVisible()
  await page.goto('/family')
  await expect(page.getByText('家庭财富尚未完整覆盖')).toBeVisible()
  await page.goto('/accounts')
  await expect(page.getByLabel('估值有效期（天）')).toHaveValue('7')
  await page.getByRole('button', { name: '确认纳入范围已完整' }).click()
  await page.goto('/family')
  await expect(page.getByText(/已覆盖财富/)).toBeVisible()
})
