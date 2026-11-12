import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures'

test('家庭邀请、授权、共担账单和议事形成完整流程', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const leaderPrivate = `个人支出-${randomUUID().slice(0, 8)}`
  const memberCommon = `家庭超市-${randomUUID().slice(0, 8)}`
  const memberPrivate = `个人书店-${randomUUID().slice(0, 8)}`
  const familyName = `浏览器验收家庭-${randomUUID().slice(0, 8)}`

  await page.goto('/family')
  await page.getByRole('button', { name: '创建家庭' }).click()
  await page.getByLabel('家庭名称').fill(familyName)
  await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByRole('heading', { name: '家庭财务' })).toBeVisible()

  await page.goto('/family/members')
  const inviteResponse = page.waitForResponse(response => response.url().endsWith('/api/families/invitations') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '生成邀请码' }).click()
  const invite = await (await inviteResponse).json() as { code: string }
  expect(invite.code.length).toBeGreaterThan(15)
  await expect(page.getByText(invite.code)).toBeVisible()

  const member = await browser.newContext()
  try {
    const memberPage = await member.newPage()
    await memberPage.goto('/family')
    await memberPage.getByRole('tab', { name: '注册' }).click()
    await memberPage.getByLabel('称呼').fill('家庭成员')
    await memberPage.getByLabel('邮箱').fill(`member-${randomUUID()}@example.test`)
    await memberPage.getByLabel('密码').fill('Playwright-Test-2026!')
    await memberPage.getByRole('button', { name: '创建账号' }).click()
    await expect(memberPage.getByRole('heading', { name: '开启家庭空间' })).toBeVisible()

    await memberPage.getByRole('button', { name: '输入邀请码' }).click()
    await memberPage.getByLabel('邀请码').fill(invite.code)
    await memberPage.getByRole('button', { name: '查看邀请' }).click()
    await expect(memberPage.getByRole('dialog')).toContainText(familyName)
    await expect(memberPage.getByRole('dialog').getByRole('button', { name: '确认加入' })).toBeDisabled()
    const sharedFrom = await memberPage.locator('#share-from').inputValue()
    await memberPage.getByRole('dialog').getByRole('checkbox').check()
    await memberPage.getByRole('dialog').getByRole('button', { name: '确认加入' }).click()
    await expect(memberPage.getByRole('heading', { name: '我的家庭共担' })).toBeVisible()

    async function createTransaction(context: typeof member, merchant: string) {
      const response = await context.request.post('http://127.0.0.1:18080/api/transactions', {
        data: { tx_date: sharedFrom, amount_cents: 12300, tx_type: 'expense', merchant, category: '餐饮' },
      })
      expect(response.ok(), await response.text()).toBeTruthy()
      return await response.json() as { id: number }
    }
    await createTransaction(page.context(), leaderPrivate)
    await createTransaction(member, memberPrivate)
    await createTransaction(member, memberCommon)

    await memberPage.goto('/ledger')
    await memberPage.getByRole('button', { name: memberCommon }).click()
    await memberPage.getByRole('button', { name: '标为家庭共担', exact: true }).click()
    await expect(memberPage.getByRole('button', { name: /已标为家庭共担/ })).toBeVisible()

    await page.goto('/family/transactions')
    await expect(page.getByRole('button', { name: memberCommon })).toBeVisible()
    await expect(page.getByRole('button', { name: memberPrivate })).toBeVisible()
    await page.goto('/family/transactions?common_only=true')
    await expect(page.getByRole('button', { name: memberCommon })).toBeVisible()
    await expect(page.getByRole('button', { name: memberPrivate })).toHaveCount(0)

    await memberPage.goto('/family/transactions')
    await expect(memberPage.getByRole('button', { name: leaderPrivate })).toHaveCount(0)
    await expect(memberPage.getByRole('button', { name: memberCommon })).toBeVisible()

    await memberPage.goto('/family/decisions?new=1')
    await memberPage.getByLabel('计划名称').fill('周末共同采购')
    await memberPage.getByRole('spinbutton', { name: '计划金额' }).fill('123')
    await memberPage.getByLabel('分类', { exact: true }).fill('餐饮')
    await memberPage.getByRole('button', { name: '预览影响' }).click()
    await expect(memberPage.getByText('方案对比')).toBeVisible()
    await memberPage.getByRole('button', { name: '提交计划' }).click()
    await expect(memberPage.getByRole('heading', { name: '周末共同采购' })).toBeVisible()

    await page.goto('/family/decisions')
    await page.getByRole('button', { name: /周末共同采购/ }).click()
    await page.getByRole('button', { name: '确认计划' }).click()
    await expect(page.getByRole('status').filter({ hasText: '计划已确认' })).toBeVisible()
    await page.getByRole('combobox', { name: '选择实际账单' }).click()
    await page.getByRole('option', { name: new RegExp(memberCommon) }).click()
    await page.getByRole('button', { name: '关联账单' }).click()
    await expect(page.getByText(/已关联账单/)).toBeVisible()
  } finally {
    await member.close()
  }
})

test('共同目标记录投入后，议事预览显示可解释的日期变化', async ({ page }) => {
  const apiUrl = 'http://127.0.0.1:18080'
  const family = await page.context().request.post(`${apiUrl}/api/families`, {
    data: { name: `目标验收家庭-${randomUUID().slice(0, 8)}` },
  })
  expect(family.ok(), await family.text()).toBeTruthy()
  const goal = await page.context().request.post(`${apiUrl}/api/families/goals`, {
    data: {
      name: '装修储蓄', target_cents: 10000, current_cents: 5000,
      monthly_contribution_cents: 1000, source_note: '测试储蓄账户',
    },
  })
  expect(goal.ok(), await goal.text()).toBeTruthy()

  await page.goto('/family/decisions?new=1')
  await page.getByRole('spinbutton', { name: '计划金额' }).fill('20')
  await page.getByRole('combobox', { name: '关联储蓄目标' }).click()
  await page.getByRole('option', { name: '装修储蓄' }).click()
  await page.getByRole('button', { name: '预览影响' }).click()
  await expect(page.getByText('储蓄目标日期影响')).toBeVisible()
  await expect(page.getByText('预计推迟 2 个月', { exact: false })).toBeVisible()
})

test('双成员共有账户估值一致只计一次，冲突时不展示净资产', async ({ page, browser }) => {
  const apiUrl = 'http://127.0.0.1:18080'
  const leaderRequest = page.context().request
  const family = await leaderRequest.post(`${apiUrl}/api/families`, {
    data: { name: `共有账户验收-${randomUUID().slice(0, 8)}` },
  })
  expect(family.ok(), await family.text()).toBeTruthy()
  const invitation = await leaderRequest.post(`${apiUrl}/api/families/invitations`, { data: {} })
  expect(invitation.ok(), await invitation.text()).toBeTruthy()
  const { code } = await invitation.json() as { code: string }
  const sharedKey = `Joint-${randomUUID().slice(0, 8)}`
  const asOf = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })

  const member = await browser.newContext()
  try {
    const register = await member.request.post(`${apiUrl}/api/auth/register`, {
      data: { email: `joint-${randomUUID()}@example.test`, password: 'Playwright-Test-2026!', display_name: '共同持有人' },
    })
    expect(register.ok(), await register.text()).toBeTruthy()
    const accept = await member.request.post(`${apiUrl}/api/families/invitations/accept`, {
      data: { code, share_from: asOf, share_transactions: true },
    })
    expect(accept.ok(), await accept.text()).toBeTruthy()

    const snapshot = (key: string, amount: number, accountKey?: string) => ({
      ...(accountKey ? { account_key: accountKey } : {}),
      name: '两人共用现金账户', kind: 'asset', ownership: 'joint', shared_account_key: key,
      balance_cents: amount, as_of: asOf, include_in_family: true, is_cash_account: true,
    })
    const leaderAsset = await leaderRequest.post(`${apiUrl}/api/users/me/assets`, {
      data: snapshot(sharedKey, 500000),
    })
    expect(leaderAsset.ok(), await leaderAsset.text()).toBeTruthy()
    const memberAsset = await member.request.post(`${apiUrl}/api/users/me/assets`, {
      data: snapshot(sharedKey.toLowerCase(), 500000),
    })
    expect(memberAsset.ok(), await memberAsset.text()).toBeTruthy()
    const memberAccountKey = (await memberAsset.json() as { account_key: string }).account_key
    for (const context of [page.context(), member]) {
      const confirmed = await context.request.put(`${apiUrl}/api/users/me/assets/coverage`, {
        data: { confirmed: true },
      })
      expect(confirmed.ok(), await confirmed.text()).toBeTruthy()
    }

    await page.goto('/family')
    await expect(page.getByText(/已覆盖财富/)).toContainText('¥5,000.00')
    const covered = await leaderRequest.get(`${apiUrl}/api/families/dashboard`)
    expect(covered.ok(), await covered.text()).toBeTruthy()
    expect((await covered.json() as { net_worth_cents: number }).net_worth_cents).toBe(500000)

    const changed = await member.request.post(`${apiUrl}/api/users/me/assets`, {
      data: snapshot(sharedKey.toLowerCase(), 600000, memberAccountKey),
    })
    expect(changed.ok(), await changed.text()).toBeTruthy()
    const reconfirmed = await member.request.put(`${apiUrl}/api/users/me/assets/coverage`, {
      data: { confirmed: true },
    })
    expect(reconfirmed.ok(), await reconfirmed.text()).toBeTruthy()
    await page.reload()
    await expect(page.getByText('家庭财富尚未完整覆盖')).toBeVisible()
    const conflicted = await leaderRequest.get(`${apiUrl}/api/families/dashboard`)
    expect(conflicted.ok(), await conflicted.text()).toBeTruthy()
    const conflict = await conflicted.json() as { net_worth_cents: number | null; coverage_details: { reason: string | null }[] }
    expect(conflict.net_worth_cents).toBeNull()
    expect(conflict.coverage_details.some(item => item.reason?.includes('共有账户代号') && item.reason.includes('2 条记录不一致'))).toBeTruthy()
    expect(JSON.stringify(conflict.coverage_details)).not.toContain('600000')
  } finally {
    await member.close()
  }
})
