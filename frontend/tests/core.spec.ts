import { test, expect } from './fixtures'
test('核心工作区可导航并运行模拟', async ({ page }) => {
  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible()
  await page.getByRole('link', { name: '消费模拟' }).click()
  await expect(page.getByRole('heading', { name: '消费前，先看后果' })).toBeVisible()
  await page.getByRole('button', { name: '运行模拟' }).click()
  await expect(page.getByText('购买前后现金流')).toBeVisible()
  await page.getByRole('link', { name: '账本' }).click()
  await expect(page.getByRole('heading', { name: '账本' })).toBeVisible()
})
