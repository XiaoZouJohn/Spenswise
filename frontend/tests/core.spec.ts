import { test, expect } from './fixtures'
test('核心工作区可导航并运行模拟', async ({ page }) => {
  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: '首页' })).toBeVisible()
  await page.getByRole('link', { name: '消费模拟' }).click()
  await expect(page.getByRole('heading', { name: '消费前，先看下个月的结果' })).toBeVisible()
  await page.getByRole('button', { name: '运行下月模拟' }).click()
  await expect(page.getByRole('heading', { name: /下个月购买前后现金流/ })).toBeVisible()
  await page.getByRole('link', { name: '账本' }).click()
  await expect(page.getByRole('heading', { name: '账本' })).toBeVisible()
})
