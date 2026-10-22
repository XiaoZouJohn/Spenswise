import { expect, test } from './fixtures'

test('sidebar hides its menu during family onboarding', async ({ page }) => {
  await page.goto('/overview')
  await expect(page.locator('aside nav')).toBeVisible()

  await page.goto('/family')
  await expect(page.locator('aside')).toBeVisible()
  await expect(page.locator('aside nav')).toHaveCount(0)

  await page.getByRole('button', { name: '创建家庭' }).click()
  await page.getByLabel('家庭名称').fill('侧栏验证家庭')
  await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click()

  await expect(page.locator('aside nav')).toBeVisible()
  await expect(page.locator('aside nav').getByRole('link', { name: '家庭财务' })).toBeVisible()
})
