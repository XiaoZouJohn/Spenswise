import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, json } from '../lib/api'
import type { OverviewData, SettingsData, BudgetStatusData } from '../types'
import { AmountInput, Money } from '../components/business'
import { BudgetLimitsEditor } from '../components/BudgetLimitsEditor'
import { Button, Card, Disclosure, SectionTitle, State } from '../components/ui'

export function SettingsPage({ onBudgetPreview }: { onBudgetPreview?: (status: BudgetStatusData | null) => void }) {
  const cache = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/settings') })
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/overview') })
  const [form, setForm] = useState<SettingsData | null>(null)
  useEffect(() => { if (settings.data) setForm(settings.data) }, [settings.data])
  const changed = !!form && !!settings.data && (form.monthly_budget_cents !== settings.data.monthly_budget_cents || JSON.stringify(form.category_budgets) !== JSON.stringify(settings.data.category_budgets))
  const preview = useQuery({
    queryKey: ['budget-preview', form?.monthly_budget_cents, form?.category_budgets],
    queryFn: () => api<BudgetStatusData>('/budget/preview', json('POST', { monthly_budget_cents: form!.monthly_budget_cents, category_budgets: form!.category_budgets })),
    enabled: changed,
  })
  useEffect(() => { onBudgetPreview?.(changed ? preview.data ?? null : null) }, [changed, preview.data, onBudgetPreview])
  useEffect(() => () => onBudgetPreview?.(null), [onBudgetPreview])
  const save = useMutation({
    mutationFn: (value: SettingsData) => api<SettingsData>('/settings', json('PUT', value)),
    onSuccess: value => {
      cache.setQueryData(['settings'], value)
      setForm(value)
      for (const key of ['overview', 'budget-status', 'budget-preview', 'cashflow-outlook']) void cache.invalidateQueries({ queryKey: [key] })
    },
  })
  const categoryTotal = form?.category_budgets.reduce((sum, item) => sum + item.limit_cents, 0) ?? 0
  return <div className="page space-y-6">
    <header><p className="mb-1 text-sm text-muted">议事厅 / 每月的花费安排</p><h1 className="m-0 text-3xl font-semibold">预算</h1><p className="mt-2 text-muted">先定好这个月准备花多少，再按类别分配。</p></header>
    {settings.isLoading ? <State kind="loading"/> : settings.isError ? <State kind="error" retry={() => settings.refetch()}/> : form && <>
      <Card><SectionTitle title="每月总预算"/><AmountInput label="计划支出上限" value={form.monthly_budget_cents} onChange={monthly_budget_cents => setForm({ ...form, monthly_budget_cents })}/></Card>
      <Card><Disclosure title="分类预算" description="给餐饮、交通等类别安排每月额度" defaultOpen><BudgetLimitsEditor items={form.category_budgets} observedCategories={overview.data?.category_spend.map(item => item.category) || []} onChange={category_budgets => setForm({ ...form, category_budgets })}/><div className="mt-5 flex flex-wrap items-center gap-4"><span>分类预算合计：<Money cents={categoryTotal}/></span><Button variant="secondary" disabled={!form.category_budgets.length} onClick={() => setForm({ ...form, monthly_budget_cents: categoryTotal })}>用分类合计填写总预算</Button></div></Disclosure></Card>
      <div className="flex items-center gap-3"><Button disabled={!changed || save.isPending} onClick={() => save.mutate(form)}>保存预算</Button>{save.isSuccess && <span role="status">预算已保存</span>}{save.isError && <span role="alert" className="text-danger">保存失败：{save.error.message}</span>}</div>
    </>}
  </div>
}
