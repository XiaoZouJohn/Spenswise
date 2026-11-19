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

test('助手历史记录纵向展开，删除前确认，删除后更新当前对话', async ({ page }) => {
  await mockShell(page)
  await page.route('**/api/village/journey', route => route.fulfill({ json: {
    revision: 0, welcome_dismissed: true, show_welcome: false, tour_step: 0,
    seen_tips: ['assistant'], has_transactions: false, login_streak: 0,
    log_count: 0, plan_streak: 0, achievements: [],
  } }))
  const firstId = '44444444-4444-4444-8444-444444444444'
  const secondId = '66666666-6666-4666-8666-666666666666'
  let rows = [
    { id: firstId, title: '预算建议', created_at: '2026-10-10T12:00:00Z' },
    { id: secondId, title: '消费分析', created_at: '2026-10-09T12:00:00Z' },
  ]
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: rows }))
  await page.route('**/api/ai/conversations/*', route => {
    const id = route.request().url().split('/').at(-1)!
    if (route.request().method() === 'DELETE') {
      rows = rows.filter(item => item.id !== id)
      return route.fulfill({ json: { deleted: true } })
    }
    return route.fulfill({ json: { id, title: rows.find(item => item.id === id)?.title || '', used_ledger: false, messages: [
      { id: 1, role: 'assistant', content: '这是已保存的回答', reasoning: '', thinking: false },
    ] } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openChat(page)
  const toggle = page.getByTestId('ai-history-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.ai-history-row')).toHaveCount(2)
  await expect(page.locator('.ai-history-list')).toHaveCSS('display', 'block')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    const rowTops = await page.locator('.ai-history-row').evaluateAll(items => items.map(item => item.getBoundingClientRect().top))
    expect(rowTops[1]).toBeGreaterThan(rowTops[0])
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('.ai-history-item', { hasText: '预算建议' }).click()
  await expect(page.getByTestId('ai-message')).toContainText('这是已保存的回答')
  await toggle.click()
  await page.getByRole('button', { name: '删除对话：预算建议' }).click()
  await expect(page.getByRole('dialog', { name: '删除聊天记录' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.locator('.ai-history-row')).toHaveCount(2)
  await page.getByRole('button', { name: '删除对话：预算建议' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.ai-history-row')).toHaveCount(1)
  await expect(page.getByTestId('ai-message')).toHaveCount(0)
  await expect(page.getByText('从一个问题开始')).toBeVisible()
})

test('Story 默认展示，助手可展开收起，路由切换保留会话草稿', async ({ page }) => {
  await mockShell(page)
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: [] }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await openChat(page)
  await page.getByTestId('ai-composer').fill('保留这段草稿')
  await page.getByRole('button', { name: '收起 AI 对话' }).click()
  await expect(page.getByTestId('village-story')).toBeVisible()
  await page.getByRole('navigation', { name: '地点导航' }).getByRole('link', { name: '账房' }).click()
  await page.getByTestId('ai-bubble').click()
  await expect(page.getByTestId('ai-composer')).toHaveValue('保留这段草稿')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('ai-composer')).toBeVisible()
  await expect(page.getByTestId('ai-send')).toBeVisible()
  await page.getByRole('button', { name: '收起 AI 对话' }).click()
  await expect(page.getByTestId('ai-chat-window')).toBeHidden()
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
  expect(submitted).toMatchObject({ conversation_id: null, thinking: true }); expect(submitted?.message).toContain('请帮我分析预算')

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
  expect(submitted).toMatchObject({ thinking: false }); expect(submitted?.message).toContain('怎样开始做预算？')
  await expect(page.getByTestId('ai-reasoning')).toHaveCount(0)
})

test('无首页授权按钮，既有撤销授权仍阻止旧账本对话继续', async ({ page }) => {
  await mockShell(page)
  const oldId = '33333333-3333-4333-8333-333333333333'
  await page.route('**/api/ai/conversations', route => route.fulfill({ json: [
    { id: oldId, title: '旧账本对话', created_at: '2026-10-10T10:00:00Z' },
  ] }))
  await page.route('**/api/ai/conversations/*', route => route.fulfill({ json: {
    id: oldId, title: '旧账本对话', used_ledger: true, messages: [
      { id: 1, role: 'assistant', content: '以前的答复', reasoning: '', thinking: false },
    ],
  } }))
  await openChat(page)
  await expect(page.getByTestId('ai-ledger-consent-toggle')).toHaveCount(0)
  await selectHistory(page, '旧账本对话')
  await expect(page.getByTestId('ai-composer')).toBeDisabled()
  await page.getByRole('button', { name: '新建对话以继续' }).click()
  await expect(page.getByTestId('ai-composer')).toBeEnabled()
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
  await page.getByRole('button', { name: '同意并开启全部 AI 功能' }).click()
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('连接成功')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('API Key')).toHaveValue('')
  await expect(page.getByText('已配置')).toBeVisible()
})
