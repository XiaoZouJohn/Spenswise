import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, json } from '../lib/api'
import type { OverviewData, SettingsData, BudgetStatusData } from '../types'
import { AmountInput, Money } from '../components/business'
import { BudgetLimitsEditor } from '../components/BudgetLimitsEditor'
import { AiConnectionSettings } from '../components/AiConnectionSettings'
import { AgentReminderSettings } from '../components/AgentReminder'
import { agentApi } from '../lib/agent'
import { getAiConnection } from '../lib/aiConnection'
import { useSession } from '../lib/session'
import { Badge, Button, Card, CenterDialog, Disclosure, SectionTitle, State } from '../components/ui'


function sameSettings(left: SettingsData, right: SettingsData) {
  return left.monthly_budget_cents === right.monthly_budget_cents &&
    left.opening_balance_cents === right.opening_balance_cents &&
    left.ai_consent === right.ai_consent &&
    left.category_budgets.length === right.category_budgets.length &&
    left.category_budgets.every(item => right.category_budgets.some(saved => saved.category === item.category && saved.limit_cents === item.limit_cents))
}

function readDraft(draftKey: string): SettingsData | null {
  try {
    const stored = localStorage.getItem(draftKey)
    if (!stored) return null
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object') return null
    const draft = value as SettingsData
    if (!Number.isSafeInteger(draft.monthly_budget_cents) || !Number.isSafeInteger(draft.opening_balance_cents) ||
      typeof draft.ai_consent !== 'boolean' || !Array.isArray(draft.category_budgets) ||
      !draft.category_budgets.every(item => typeof item.category === 'string' && Number.isSafeInteger(item.limit_cents))) return null
    return draft
  } catch { return null }
}

export function SettingsPage({ onBudgetPreview }: { onBudgetPreview?: (status: BudgetStatusData | null) => void }) {
  const cache = useQueryClient()
  const session = useSession()
  const draftKey = `spendwise-settings-draft-v1:${session.data?.user.id ?? 'anonymous'}`
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/settings') })
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/overview') })
  const connection = useQuery({ queryKey: ['ai-connection'], queryFn: getAiConnection })
  const preferenceKey = ['agent-preferences', session.data?.user.id]
  const preferences = useQuery({ queryKey: preferenceKey, queryFn: agentApi.preferences, enabled: !!session.data })
  const [form, setForm] = useState<SettingsData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [agreementBusy, setAgreementBusy] = useState(false)
  const [agreementError, setAgreementError] = useState('')
  const agreementPrompted = useRef(false)
  const latestForm = useRef<SettingsData | null>(null)
  const dirtyNow = useRef(false)
  const categoryTotal = form?.category_budgets.reduce((sum, item) => sum + item.limit_cents, 0) ?? 0
  const hasBudgetDraft = !!form && !!query.data && (
    form.monthly_budget_cents !== query.data.monthly_budget_cents ||
    form.category_budgets.length !== query.data.category_budgets.length ||
    form.category_budgets.some(item => !query.data!.category_budgets.some(saved => saved.category === item.category && saved.limit_cents === item.limit_cents))
  )
  const preview = useQuery({
    queryKey: ['budget-preview', form?.monthly_budget_cents, form?.category_budgets],
    queryFn: () => api<BudgetStatusData>('/budget/preview', json('POST', {
      monthly_budget_cents: form!.monthly_budget_cents,
      category_budgets: form!.category_budgets,
    })),
    enabled: form !== null,
    placeholderData: previous => previous,
  })

  useEffect(() => {
    if (!query.data || dirtyNow.current) return
    const draft = readDraft(draftKey)
    if (draft && !sameSettings(draft, query.data)) {
      latestForm.current = draft
      dirtyNow.current = true
      setDirty(true)
      setForm(draft)
    } else {
      localStorage.removeItem(draftKey)
      latestForm.current = query.data
      setForm(query.data)
    }
  }, [query.data])
  useEffect(() => { onBudgetPreview?.(hasBudgetDraft ? preview.data ?? null : null) }, [hasBudgetDraft, onBudgetPreview, preview.data])
  useEffect(() => () => onBudgetPreview?.(null), [onBudgetPreview])
  useEffect(() => {
    if (!form || !connection.data?.configured || !preferences.data || agreementPrompted.current) return
    const needsAgreement = !form.ai_consent || !preferences.data.automatic_enabled || !preferences.data.ai_enabled
    if (!needsAgreement) return
    agreementPrompted.current = true
    setAgreementOpen(true)
  }, [connection.data?.configured, form, preferences.data])

  const save = useMutation({
    mutationFn: (value: SettingsData) => api<SettingsData>('/settings', json('PUT', value)),
    scope: { id: 'spendwise-settings' },
    onSuccess: (stored, submitted) => {
      cache.setQueryData(['settings'], stored)
      if (latestForm.current === submitted) {
        dirtyNow.current = false
        setDirty(false)
        localStorage.removeItem(draftKey)
        latestForm.current = stored
        setForm(stored)
      }
      cache.invalidateQueries({ queryKey: ['overview'] })
      cache.invalidateQueries({ queryKey: ['cashflow-outlook'] })
      cache.invalidateQueries({ queryKey: ['budget-status'] })
      cache.invalidateQueries({ queryKey: ['budget-preview'] })
      cache.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })

  function changeForm(next: SettingsData) {
    latestForm.current = next
    dirtyNow.current = true
    setForm(next)
    setDirty(true)
    localStorage.setItem(draftKey, JSON.stringify(next))
    if (save.isError) save.reset()
  }

  useEffect(() => {
    if (!dirty || !form || save.isPending || save.isError) return
    const timer = window.setTimeout(() => save.mutate(form), 600)
    return () => window.clearTimeout(timer)
  }, [dirty, form, save.isPending, save.isError, save.mutate])

  const flushOnLeave = useRef(() => {})
  flushOnLeave.current = () => {
    if (dirtyNow.current && latestForm.current) save.mutate(latestForm.current)
  }
  useEffect(() => () => flushOnLeave.current(), [])

  async function acceptAiAgreement() {
    if (!form) return
    setAgreementBusy(true)
    setAgreementError('')
    const next = { ...form, ai_consent: true }
    latestForm.current = next
    dirtyNow.current = true
    setForm(next)
    try {
      const [, storedPreferences] = await Promise.all([
        save.mutateAsync(next),
        agentApi.savePreferences({ automatic_enabled: true, ai_enabled: true }),
      ])
      cache.setQueryData(preferenceKey, storedPreferences)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['ai-status'] }),
        cache.invalidateQueries({ queryKey: ['ai-ledger-consent'] }),
        cache.invalidateQueries({ queryKey: preferenceKey }),
      ])
      setAgreementOpen(false)
    } catch (issue) {
      setAgreementError(issue instanceof Error ? issue.message : '保存 AI 授权失败，请重试。')
    } finally {
      setAgreementBusy(false)
    }
  }

  return <div className="page space-y-6">
    <header id="budget"><p className="mb-1 text-sm text-muted">商会大厅 / 每月沿用的消费标准</p><h1 className="m-0 text-3xl font-semibold">预算与设置</h1></header>
    {query.isLoading ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : form && <>
      <Card>
        <SectionTitle title="总预算与账户"/>
        <div className="grid gap-5 md:grid-cols-2">
          <AmountInput label="每月总消费上限" value={form.monthly_budget_cents} onChange={value => changeForm({ ...form, monthly_budget_cents: value })}/>
          <AmountInput label="账户期初余额" value={form.opening_balance_cents} onChange={value => changeForm({ ...form, opening_balance_cents: value })}/>
        </div>
        <p className="mb-0 text-xs text-muted">消费上限按当月支出扣除退款计算；收入和转账不抵扣消费。账户余额单独计算。</p>
      </Card>
      <Card>
        <Disclosure title="分类预算" description="展开后设置餐饮、交通等分类的每月上限" badge={<Badge>{form.category_budgets.length} 个分类已设限</Badge>}>
          <BudgetLimitsEditor items={form.category_budgets} observedCategories={overview.data?.category_spend.map(item => item.category) || []} onChange={category_budgets => changeForm({ ...form, category_budgets })}/>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
            <p className="m-0 text-sm">已设置分类预算合计：<span className="font-semibold"><Money cents={categoryTotal}/></span></p>
            <Button variant="secondary" data-testid="apply-category-budget-total" disabled={form.category_budgets.length === 0} onClick={() => { const next = { ...form, monthly_budget_cents: categoryTotal }; changeForm(next); save.mutate(next) }}>确认并填入总预算</Button>
          </div>
        </Disclosure>
      </Card>
      <AiConnectionSettings onConfigured={() => {
        if (form.ai_consent && preferences.data?.automatic_enabled && preferences.data?.ai_enabled) return
        agreementPrompted.current = true
        setAgreementError('')
        setAgreementOpen(true)
      }}/>
      <div className="flex items-center gap-3"><Button onClick={() => save.mutate(form)} disabled={save.isPending}>立即保存</Button><span role="status" className="text-sm text-muted">{save.isPending ? '正在保存…' : save.isError ? '保存失败，草稿已保留' : dirty ? '修改已暂存，正在自动保存' : '已保存'}</span></div>
      <AgentReminderSettings/>
      {save.isError && <p role="alert" className="text-sm text-danger">保存失败，修改仍保留在本机。请稍后点击“立即保存”重试。{save.error.message}</p>}
    </>}
    <CenterDialog open={agreementOpen} onOpenChange={() => {}} title="同意 AI 服务协议" dismissible={false}>
      <div className="space-y-4 text-sm leading-7">
        <p className="m-0">连接 DeepSeek 后，SpendWise 会默认开启下列 AI 功能：</p>
        <ul className="m-0 space-y-2 pl-5">
          <li>使用必要的账单文本辅助分类。</li>
          <li>使用月度与分类汇总复核消费预测。</li>
          <li>允许 AI 对话和 Agent 简报按需读取本人账本，并开启重要变化自动提醒。</li>
        </ul>
        <p className="m-0 text-muted">API Key 仅由服务端加密保存，不在页面中显示。点击下方按钮即表示同意以上全部内容。</p>
        {agreementError && <p role="alert" className="m-0 text-danger">{agreementError}</p>}
        <Button className="w-full" disabled={agreementBusy} onClick={acceptAiAgreement}>{agreementBusy ? '正在启用…' : '同意并开启全部 AI 功能'}</Button>
      </div>
    </CenterDialog>
  </div>
}

