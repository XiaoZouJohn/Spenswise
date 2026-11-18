import { expect, test } from './fixtures'

test('家庭加入前不显示内部功能，创建后可导航且不展开个人 AI', async ({ page }) => {
  await page.goto('/family')
  await expect(page.getByRole('navigation', { name: '家庭功能' })).toHaveCount(0)
  await expect(page.getByTestId('ai-bubble')).toHaveCount(0)
  await page.getByRole('button', { name: '创建家庭' }).click()
  await page.getByLabel('家庭名称').fill('村庄导航验证家庭')
  await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '家庭功能' })).toBeVisible()
  await page.getByRole('navigation', { name: '家庭功能' }).getByRole('link', { name: '共同目标' }).click()
  await expect(page).toHaveURL(/\/family\/goals$/)
})
