import { test, expect } from './fixtures'
test('核心工作区可导航并运行模拟', async ({ page }) => {
  await page.goto('/overview')
  await expect(page.getByTestId('village-story')).toBeVisible()
  await page.getByRole('navigation', { name: '地点导航' }).getByRole('link', { name: '集市' }).click()
  await expect(page.getByRole('heading', { name: '消费模拟' })).toBeVisible()
  await page.getByRole('button', { name: '运行下月模拟' }).click()
  await expect(page.getByRole('heading', { name: /下个月购买前后现金流/ })).toBeVisible()
  await page.getByRole('navigation', { name: '地点导航' }).getByRole('link', { name: '账房' }).click()
  await expect(page.getByRole('heading', { name: '账本' })).toBeVisible()
})
