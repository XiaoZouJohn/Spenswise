import { expect, test } from './fixtures'

test('本月预算超额保留警示入口，由用户打开详情', async ({ page }) => {
  await page.route('**/api/budget/status', route => route.fulfill({
    json: {
      month: '2026-10',
      as_of: '2026-10-08',
      income_cents: 680000,
      spent_cents: 418000,
      total_limit_cents: 300000,
      data_version: 'budget-warning-demo',
      alerts: [
        { scope: 'total', category: null, limit_cents: 300000, spent_cents: 418000, over_cents: 118000 },
        { scope: 'category', category: '餐饮', limit_cents: 80000, spent_cents: 115000, over_cents: 35000 },
      ],
    },
  }))

  await page.goto('/overview')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '关闭简报' }).click()
  await page.getByRole('button', { name: /查看警示/ }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('总消费预算')).toBeVisible()
  await expect(dialog.getByText('餐饮预算')).toBeVisible()
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox()
    return bounds ? Math.abs(bounds.x + bounds.width / 2 - page.viewportSize()!.width / 2) : Infinity
  }).toBeLessThan(3)
  await dialog.getByRole('button', { name: '关闭弹窗' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: /查看警示/ }).click()
  await expect(dialog).toBeVisible()
})

test('填写总预算和分类预算时全局警示即时更新', async ({ page }) => {
  let previewCalls = 0
  let saves = 0
  let stored = {
    monthly_budget_cents: 300000, opening_balance_cents: 0, ai_consent: false,
    category_budgets: [{ category: '餐饮', limit_cents: 80000 }],
    currency: 'CNY', timezone: 'Asia/Shanghai',
  }
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'PUT') { saves += 1; stored = { ...stored, ...route.request().postDataJSON() } }
    return route.fulfill({ json: stored })
  })
  function budgetStatus(draft: Pick<typeof stored, 'monthly_budget_cents' | 'category_budgets'>) {
    const alerts = []
    if (115000 > draft.monthly_budget_cents) alerts.push({
      scope: 'total', category: null, limit_cents: draft.monthly_budget_cents,
      spent_cents: 115000, over_cents: 115000 - draft.monthly_budget_cents,
    })
    if (115000 > draft.category_budgets[0].limit_cents) alerts.push({
      scope: 'category', category: '餐饮', limit_cents: draft.category_budgets[0].limit_cents,
      spent_cents: 115000, over_cents: 115000 - draft.category_budgets[0].limit_cents,
    })
    return {
      month: '2026-10', as_of: '2026-10-08', income_cents: 0, spent_cents: 115000,
      total_limit_cents: draft.monthly_budget_cents, alerts, data_version: String(saves),
    }
  }
  await page.route('**/api/budget/status', route => route.fulfill({ json: budgetStatus(stored) }))
  await page.route('**/api/budget/preview', route => {
    previewCalls += 1
    return route.fulfill({ json: budgetStatus(route.request().postDataJSON()) })
  })

  await page.goto('/settings')
  await expect(page.getByText('预算警示预览')).toHaveCount(0)
  await page.getByRole('spinbutton', { name: '每月总消费上限' }).fill('1000')
  await expect(page.getByRole('button', { name: /2 项预算超额/ })).toBeVisible()
  await page.getByRole('spinbutton', { name: '每月上限' }).fill('1200')
  await expect(page.getByRole('button', { name: /1 项预算超额/ })).toBeVisible()
  await page.getByRole('button', { name: /查看警示/ }).click()
  await expect(page.getByRole('dialog')).toContainText('预算警示')
  await expect(page.getByRole('dialog').getByText('总消费预算')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('餐饮预算')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('spinbutton', { name: '每月总消费上限' }).fill('1500')
  await expect(page.getByRole('button', { name: /查看警示/ })).toBeHidden()
  expect(previewCalls).toBeGreaterThan(1)
  await expect.poll(() => stored.monthly_budget_cents).toBe(150000)
})

test('预算修改后切换页面仍保留并写入设置接口', async ({ page }) => {
  let stored = {
    monthly_budget_cents: 300000, opening_balance_cents: 0, ai_consent: false,
    category_budgets: [] as { category: string; limit_cents: number }[],
    currency: 'CNY', timezone: 'Asia/Shanghai',
  }
  let saves = 0
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'PUT') {
      stored = { ...stored, ...route.request().postDataJSON() }
      saves += 1
    }
    return route.fulfill({ json: stored })
  })
  await page.route('**/api/budget/status', route => route.fulfill({ json: {
    month: '2026-10', as_of: '2026-10-08', income_cents: 0, spent_cents: 0,
    total_limit_cents: stored.monthly_budget_cents, alerts: [], data_version: String(saves),
  } }))
  await page.route('**/api/budget/preview', route => route.fulfill({ json: {
    month: '2026-10', as_of: '2026-10-08', income_cents: 0, spent_cents: 0,
    total_limit_cents: route.request().postDataJSON().monthly_budget_cents,
    alerts: [], data_version: 'draft',
  } }))

  await page.goto('/settings')
  await page.getByRole('button', { name: '设置上限' }).first().click()
  await page.getByRole('spinbutton', { name: '每月上限' }).fill('800')
  await page.getByRole('spinbutton', { name: '每月总消费上限' }).fill('1200')
  await page.getByRole('link', { name: '概览' }).click()
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '每月总消费上限' })).toHaveValue('1200.00')
  await expect(page.getByRole('spinbutton', { name: '每月上限' })).toHaveValue('800.00')
  await expect.poll(() => saves).toBeGreaterThan(0)
  expect(stored.monthly_budget_cents).toBe(120000)
  expect(stored.category_budgets[0].limit_cents).toBe(80000)
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: '每月总消费上限' })).toHaveValue('1200.00')
  await expect(page.getByRole('spinbutton', { name: '每月上限' })).toHaveValue('800.00')
})

