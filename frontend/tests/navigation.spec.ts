import { expect, test } from './fixtures'

test('概览承接未来收支，开发页不出现在用户导航', async ({ page }) => {
  await page.route('**/api/budget/status', route => route.fulfill({ json: {
    month: '2026-10', as_of: '2026-10-08', income_cents: 0, spent_cents: 0,
    total_limit_cents: 0, alerts: [], data_version: 'v1',
  } }))
  await page.route('**/api/overview', route => route.fulfill({ json: {
    month: '2026-10', income_cents: 0, expense_cents: 0,
    budget_remaining_cents: 0, account_balance_cents: 300000,
    category_spend: [], transaction_count: 0, data_version: 'v1',
  } }))
  await page.route('**/api/simulate', route => route.fulfill({ json: {
    minimum_after_cents: 210000,
    recurring_bills: [{ date: '2026-10-15', merchant: '房租', amount_cents: 80000, source_ids: [12] }],
  } }))

  await page.goto('/plan')
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByText('预计账户最低余额')).toBeVisible()
  await expect(page.getByText('房租')).toBeVisible()
  await expect(page.getByRole('link', { name: '月度规划' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '组件展示' })).toHaveCount(0)
  await expect(page.getByText('数据版本')).toHaveCount(0)
})
