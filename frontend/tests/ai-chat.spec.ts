import { expect, test, type Page } from './fixtures'

const quietBudget = {
  month: '2026-10', as_of: '2026-10-10', income_cents: 0, spent_cents: 0,
  total_limit_cents: 300000, alerts: [], data_version: 'ui-test',
}

async function mockShell(page: Page) {
  await page.route('**/api/budget/status', route => route.fulfill({ json: quietBudget }))
  await page.route('**/api/budget/preview', route => route.fulfill({ json: quietBudget }))
  await page.route('**/api/overview', route => route.fulfill({ json: {
    month: '2026-10', income_cents: 680000, expense_cents: 418000,
    budget_remaining_cents: 182000, account_balance_cents: 362000,
    category_spend: [
      { category: '居住', amount_cents: 150000 },
      { category: '餐饮', amount_cents: 98000 },
      { category: '交通', amount_cents: 42000 },
      { category: '其他', amount_cents: 128000 },
    ], transaction_count: 42, data_version: 'ui-test',
  } }))
  await page.route('**/api/simulate', route => route.fulfill({ json: {
    minimum_after_cents: 210000,
    recurring_bills: [{ date: '2026-10-15', merchant: '房租', category: '居住', amount_cents: 80000, source_ids: [12] }],
  } }))
  await page.route('**/api/ai/status', route => route.fulfill({ json: {
    consent: false, configured: true, model: 'deepseek-flash', endpoint: 'https://api.deepseek.com',
  } }))
  await page.route('**/api/ai/connection', route => route.fulfill({ json: {
    configured: true, model: 'deepseek-flash', endpoint: 'https://api.deepseek.com',
  } }))
  await page.route('**/api/ai/chat/ledger-consent', route => route.fulfill({ json: {
    enabled: false, scope: '默认关闭，可单独授权读取限定范围的账本',
  } }))
}

function sse(events: { event: string; data: Record<string, unknown> }[]) {
  return events.map(item => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join('')
}

async function openChat(page: Page) {
  await page.goto('/overview')
  await page.getByTestId('ai-bubble').click()
  await expect(page.getByTestId('ai-chat-window')).toBeVisible()
  await expect(page).toHaveURL(/\/overview$/)
}

async function selectHistory(page: Page, title: string) {
  const toggle = page.getByTestId('ai-history-toggle')
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await page.locator('.ai-history-item', { hasText: title }).click()
}

test('左下角云朵展开浮窗，收起后可拖动入口，并可移动及缩放浮窗', async ({ page }) => {
  await mockShell(page)
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: [] }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/overview')

  const bubble = page.getByTestId('ai-bubble')
  await expect(bubble).toBeVisible()
  const start = await bubble.boundingBox()
  expect(start).not.toBeNull()
  expect(start!.x).toBeLessThan(100)
  expect(start!.y).toBeGreaterThan(750)

  await bubble.click()
  await expect(page).toHaveURL(/\/overview$/)
  const panel = page.getByTestId('ai-chat-window')
  await expect(panel).toBeVisible()
  const initialPanel = await panel.boundingBox()
  expect(initialPanel).not.toBeNull()
  expect(initialPanel!.width).toBeGreaterThan(410)
  expect(initialPanel!.width).toBeLessThan(600)
  await expect(page.getByText('分类支出')).toBeVisible()
  await expect(page.getByText('房租')).toBeVisible()
  await page.screenshot({ path: 'test-results/ai-floating-panel.png' })

  const dragHandle = page.getByTestId('ai-panel-drag-handle')
  const title = await dragHandle.boundingBox()
  expect(title).not.toBeNull()
  await page.mouse.move(title!.x + title!.width / 2, title!.y + title!.height / 2)
  await page.mouse.down()
  await page.mouse.move(title!.x + title!.width / 2 + 140, title!.y + title!.height / 2 - 40, { steps: 10 })
  await page.mouse.up()
  const draggedPanel = await panel.boundingBox()
  expect(draggedPanel).not.toBeNull()
  expect(draggedPanel!.x - initialPanel!.x).toBeGreaterThan(50)
  await expect(page).toHaveURL(/\/overview$/)
  await page.screenshot({ path: 'test-results/ai-floating-panel-dragged.png' })

  await page.getByTestId('ai-panel-collapse').click()
  await expect(panel).toBeHidden()
  await expect(bubble).toBeVisible()
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2)
  await page.mouse.down()
  await page.mouse.move(start!.x + start!.width / 2 + 170, start!.y + start!.height / 2 - 100, { steps: 10 })
  await page.mouse.up()
  await expect(page).toHaveURL(/\/overview$/)
  const moved = await bubble.boundingBox()
  expect(moved).not.toBeNull()
  expect(moved!.x - start!.x).toBeGreaterThan(50)
  await expect(panel).toBeHidden()

  await bubble.click()
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/\/overview$/)
  const beforeResize = await panel.boundingBox()
  const handle = await page.getByTestId('ai-panel-resize-handle').boundingBox()
  expect(beforeResize).not.toBeNull()
  expect(handle).not.toBeNull()
  const handleX = handle!.x + handle!.width / 2
  const handleY = handle!.y + handle!.height / 2
  const moveX = handle!.x < beforeResize!.x + beforeResize!.width / 2 ? -100 : 100
  const moveY = handle!.y < beforeResize!.y + beforeResize!.height / 2 ? -80 : 80
  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX + moveX, handleY + moveY, { steps: 8 })
  await page.mouse.up()
  const afterResize = await panel.boundingBox()
  expect(afterResize).not.toBeNull()
  expect(Math.abs(afterResize!.width - beforeResize!.width)).toBeGreaterThan(30)
  await page.getByTestId('ai-panel-collapse').click()
  await expect(bubble).toBeVisible()
  const afterCollapse = await bubble.boundingBox()
  expect(afterCollapse!.x).toBeGreaterThan(start!.x + 50)
})

test('AI 回答在流式显示及历史记录中正确渲染 Markdown 加粗和列表', async ({ page }) => {
  await mockShell(page)
  const conversationId = '55555555-5555-4555-8555-555555555555'
  const markdown = '**预算重点**\n\n- 固定开支\n- 应急储备'
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: [
    { id: conversationId, title: '预算建议', created_at: '2026-10-10T12:00:00Z' },
  ] }))
  await page.route('**/api/ai/conversations/*', route => route.fulfill({ json: {
    id: conversationId, title: '预算建议', used_ledger: false, messages: [
      { id: 1, role: 'user', content: '帮我安排预算', reasoning: '', thinking: false },
      { id: 2, role: 'assistant', content: markdown, reasoning: '', thinking: false },
    ],
  } }))
  await page.route('**/api/ai/chat/stream', route => route.fulfill({
    status: 200, contentType: 'text/event-stream', body: sse([
      { event: 'status', data: { phase: 'answering' } },
      { event: 'content', data: { text: '**预算重点**\n\n- 固定开支' } },
      { event: 'content', data: { text: '\n- 应急储备' } },
      { event: 'done', data: { conversation_id: conversationId } },
    ]),
  }))

  await openChat(page)
  await page.getByTestId('ai-composer').fill('帮我安排预算')
  await page.getByTestId('ai-send').click()
  const answer = page.getByTestId('ai-message').last()
  await expect(answer.locator('strong')).toHaveText('预算重点')
  await expect(answer.locator('li')).toHaveText(['固定开支', '应急储备'])

  await page.reload()
  await page.getByTestId('ai-bubble').click()
  const restored = page.getByTestId('ai-message').last()
  await expect(restored.locator('strong')).toHaveText('预算重点')
  await expect(restored.locator('li')).toHaveText(['固定开支', '应急储备'])
})

test('预设可改写，思考与回答按事件显示，刷新可恢复会话', async ({ page }) => {
  await mockShell(page)
  const conversationId = '11111111-1111-4111-8111-111111111111'
  const conversations: { id: string; title: string; created_at: string }[] = []
  let messages: { id: number; role: string; content: string; reasoning: string; thinking: boolean }[] = []
  let submitted: { conversation_id: string | null; message: string; thinking: boolean } | undefined
  let release!: () => void
  const responseGate = new Promise<void>(resolve => { release = resolve })

  await page.route('**/api/ai/conversations', route => route.fulfill({ json: conversations }))
  await page.route('**/api/ai/conversations/*', route => route.fulfill({ json: {
    id: conversationId, title: '请帮我分析预算', used_ledger: false, messages,
  } }))
  await page.route('**/api/ai/chat/stream', async route => {
    submitted = route.request().postDataJSON()
    await responseGate
    conversations.push({ id: conversationId, title: submitted!.message, created_at: '2026-10-10T12:00:00Z' })
    messages = [
      { id: 1, role: 'user', content: submitted!.message, reasoning: '', thinking: true },
      { id: 2, role: 'assistant', content: '先核对预算和账本，再决定是否购买。', reasoning: '先区分预算与现金余额。', thinking: true },
    ]
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([
      { event: 'status', data: { phase: 'connecting' } },
      { event: 'status', data: { phase: 'thinking' } },
      { event: 'reasoning', data: { text: '先区分预算与现金余额。' } },
      { event: 'status', data: { phase: 'answering' } },
      { event: 'content', data: { text: '先核对预算和账本，' } },
      { event: 'content', data: { text: '再决定是否购买。' } },
      { event: 'done', data: { conversation_id: conversationId } },
    ]) })
  })

  await openChat(page)
  await page.getByTestId('ai-preset-select').selectOption({ index: 1 })
  await expect(page.getByTestId('ai-composer')).not.toHaveValue('')
  await page.getByTestId('ai-composer').fill('请帮我分析预算')
  await page.getByTestId('ai-thinking-toggle').check()
  await page.getByTestId('ai-send').click()
  try {
    await expect(page.getByTestId('ai-progress')).toBeVisible()
    await expect(page.getByTestId('ai-send')).toHaveAccessibleName('停止回复')
    await expect(page.locator('.ai-conversation-head').getByRole('button', { name: '停止回复' })).toHaveCount(0)
  } finally {
    release()
  }

  await expect(page.getByTestId('ai-reasoning')).toContainText('先区分预算与现金余额。')
  await expect(page.getByTestId('ai-message').last()).toContainText('再决定是否购买。')
  await expect(page.getByTestId('ai-send')).toHaveAccessibleName('发送消息')
  expect(submitted).toEqual({ conversation_id: null, message: '请帮我分析预算', thinking: true })

  await page.reload()
  await page.getByTestId('ai-bubble').click()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByTestId('ai-message').last()).toContainText('先核对预算和账本，再决定是否购买。')
  await selectHistory(page, '请帮我分析预算')
  await expect(page.getByTestId('ai-message').last()).toContainText('先核对预算和账本，再决定是否购买。')
  const thoughtToggle = page.getByTestId('ai-reasoning').getByRole('button', { name: '思考过程' })
  if (await thoughtToggle.getAttribute('aria-expanded') === 'false') await thoughtToggle.click()
  await expect(page.getByTestId('ai-reasoning')).toContainText('先区分预算与现金余额。')
})

test('关闭思考模式时请求和界面均保持普通回答', async ({ page }) => {
  await mockShell(page)
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: [] }))
  await page.route('**/api/ai/conversations/*', route => route.fulfill({ json: {
    id: '22222222-2222-4222-8222-222222222222', title: '怎样开始做预算？', used_ledger: false,
    messages: [
      { id: 1, role: 'user', content: '怎样开始做预算？', reasoning: '', thinking: false },
      { id: 2, role: 'assistant', content: '可以先设定每月上限。', reasoning: '', thinking: false },
    ],
  } }))
  let submitted: { thinking: boolean; message: string } | undefined
  await page.route('**/api/ai/chat/stream', route => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([
      { event: 'status', data: { phase: 'connecting' } },
      { event: 'status', data: { phase: 'answering' } },
      { event: 'content', data: { text: '可以先设定每月上限。' } },
      { event: 'done', data: { conversation_id: '22222222-2222-4222-8222-222222222222' } },
    ]) })
  })

  await openChat(page)
  await page.getByTestId('ai-composer').fill('怎样开始做预算？')
  await page.getByTestId('ai-thinking-toggle').uncheck()
  await page.getByTestId('ai-send').click()
  await expect(page.getByTestId('ai-message').last()).toContainText('可以先设定每月上限。')
  expect(submitted).toMatchObject({ thinking: false, message: '怎样开始做预算？' })
  await expect(page.getByTestId('ai-reasoning')).toHaveCount(0)
})

test('账本授权一键切换，撤销后隔离旧对话，普通聊天仍可发送', async ({ page }) => {
  await mockShell(page)
  const oldId = '33333333-3333-4333-8333-333333333333'
  let enabled = false
  const updates: boolean[] = []
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/ai/chat/ledger-consent', route => {
    if (route.request().method() === 'PUT') {
      enabled = route.request().postDataJSON().enabled
      updates.push(enabled)
    }
    return route.fulfill({ json: {
      enabled, scope: '本月汇总和最近 90 天最多 100 笔账单，不含备注',
    } })
  })
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: [
    { id: oldId, title: '旧账本对话', created_at: '2026-10-10T10:00:00Z' },
  ] }))
  await page.route('**/api/ai/conversations/*', route => route.fulfill({ json: {
    id: oldId, title: '旧账本对话', used_ledger: true, messages: [
      { id: 1, role: 'user', content: '看一下账本', reasoning: '', thinking: false },
      { id: 2, role: 'assistant', content: '以前的账本答复', reasoning: '', thinking: false },
    ],
  } }))
  await page.route('**/api/ai/chat/stream', route => {
    submitted = route.request().postDataJSON()
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([
      { event: 'status', data: { phase: 'answering' } },
      { event: 'content', data: { text: '先确定每月储蓄目标。' } },
      { event: 'done', data: { conversation_id: '44444444-4444-4444-8444-444444444444' } },
    ]) })
  })

  await openChat(page)
  const toggle = page.getByTestId('ai-ledger-consent-toggle')
  await expect(toggle).toContainText('关闭')
  await toggle.click()
  await expect(page.getByTestId('ai-ledger-consent-dialog')).toHaveCount(0)
  await expect(toggle).toContainText('已开启')
  expect(updates).toEqual([true])

  await selectHistory(page, '旧账本对话')
  await expect(page.getByText('以前的账本答复')).toBeVisible()
  await toggle.click()
  await expect(toggle).toContainText('关闭')
  expect(updates).toEqual([true, false])
  await expect(page).toHaveURL(/\/overview$/)
  await selectHistory(page, '旧账本对话')
  await expect(page.getByText('新建对话以继续')).toBeVisible()
  await expect(page.getByTestId('ai-composer')).toBeDisabled()

  await page.getByRole('button', { name: '新建对话以继续' }).click()
  await page.getByTestId('ai-composer').fill('怎样开始储蓄？')
  await page.getByTestId('ai-send').click()
  await expect.poll(() => submitted).toMatchObject({
    conversation_id: null, message: '怎样开始储蓄？', thinking: false,
  })
  expect(JSON.stringify(submitted)).not.toContain('账本')
})

test('连接设置保存后不在页面或浏览器缓存回显 API Key', async ({ page }) => {
  await mockShell(page)
  await page.route('**/api/settings', route => route.fulfill({ json: {
    monthly_budget_cents: 300000, opening_balance_cents: 0, ai_consent: false,
    category_budgets: [], currency: 'CNY', timezone: 'Asia/Shanghai',
  } }))
  let configured = false
  let saved: { api_key?: string; model: string } | undefined
  await page.route('**/api/ai/connection', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON()
      configured = true
    }
    return route.fulfill({ json: {
      configured, model: saved?.model || 'deepseek-flash', endpoint: 'https://api.deepseek.com',
    } })
  })
  await page.route('**/api/ai/test', route => route.fulfill({ json: {
    ok: true, message: '连接成功',
  } }))

  await page.goto('/settings#ai-connection')
  const key = page.getByLabel('API Key')
  await key.fill('sk-local-test-123456')
  await page.getByRole('button', { name: '保存连接' }).click()
  await expect(page.getByText('连接设置已保存。')).toBeVisible()
  await expect(key).toHaveValue('')
  expect(saved).toEqual({ model: 'deepseek-flash', api_key: 'sk-local-test-123456' })
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-local-test-123456')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('连接成功')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('API Key')).toHaveValue('')
  await expect(page.getByText('已配置')).toBeVisible()
})
