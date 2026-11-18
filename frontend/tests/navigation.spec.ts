import { expect, test } from './fixtures'

test('Story 为默认入口，浏览不触发模拟，原功能与旧路由可达', async ({ page }) => {
  let simulations = 0
  await page.route('**/api/simulate', route => { simulations++; return route.abort() })
  await page.goto('/plan')
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByTestId('village-story')).toBeVisible()
  await expect(page.getByTestId('ai-chat-window')).toHaveCount(0)
  await page.getByRole('button', { name: '本月结余', exact: true }).click()
  expect(simulations).toBe(0)
  await expect(page.getByRole('link', { name: '组件展示' })).toHaveCount(0)
  await page.goto('/import')
  await expect(page).toHaveURL(/\/ledger\?import=1$/)
  await expect(page.getByRole('button', { name: '读取并预览' })).toBeVisible()
})
