import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BudgetLimitsEditor } from '../components/BudgetLimitsEditor'
import { AmountInput, Money } from '../components/business'
import { Badge, Button, Card, SectionTitle, State } from '../components/ui'
import { familyErrorMessage, familyApi, type FamilyBudget } from '../lib/familyApi'
import { useSession } from '../lib/session'

export function FamilyBudgetPage() {
  const session = useSession()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['family', 'budget'], queryFn: familyApi.budget })
  const dashboard = useQuery({ queryKey: ['family', 'dashboard'], queryFn: () => familyApi.dashboard() })
  const [total, setTotal] = useState<number | null>(null)
  const [categories, setCategories] = useState<FamilyBudget['category_budgets'] | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (query.data && total === null && categories === null) { setTotal(query.data.monthly_budget_cents); setCategories(query.data.category_budgets ?? []) } }, [query.data, total, categories])

  async function save() {
    setBusy(true); setMessage('')
    try { await familyApi.updateBudget({ monthly_budget_cents: total ?? 0, category_budgets: categories ?? [] }); await client.invalidateQueries({ queryKey: ['family'] }); setMessage('共同预算已保存') }
    catch (issue) { setMessage(familyErrorMessage(issue, '保存失败')) }
    finally { setBusy(false) }
  }
  const leader = session.data?.family?.role === 'leader'
  const household = query.data?.scope === 'household'
  const totalConfigured = (query.data?.monthly_budget_cents ?? 0) > 0
  const anyLimit = totalConfigured || (query.data?.category_budgets ?? []).some(item => item.limit_cents > 0)
  return <div className="page space-y-5">
    <header><h1 className="m-0 text-3xl font-semibold">共同预算</h1><p className="mt-2 text-sm text-muted">仅统计标记为家庭共担的支出；个人预算独立计算。</p></header>
    {query.isLoading ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : query.data && <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.5fr)]">
        <Card><SectionTitle title={household ? '本月共同预算执行情况' : '我的共担支出'}/><div className="mb-4 text-3xl font-semibold"><Money cents={query.data.spent_cents}/></div>
          {household ? totalConfigured ? <><p className="m-0 text-sm text-muted">总预算 <Money cents={query.data.monthly_budget_cents}/> · 剩余 <Money cents={query.data.monthly_budget_cents - query.data.spent_cents}/></p><div className="family-budget-bar mt-5"><div style={{ width: Math.min(100, query.data.spent_cents / query.data.monthly_budget_cents * 100) + '%' }}/></div></> : <p className="m-0 text-sm text-muted">总预算未设置；可设置总额或分类限额。</p> : <p className="m-0 text-sm leading-6 text-muted">总预算由组长管理。此处仅统计你的共担账单，不能据此计算全家预算剩余。</p>}
        </Card>
        <Card><SectionTitle title={household ? '预算提醒' : '预算范围'}/>{household ? query.data.alerts.length ? <div className="space-y-3">{query.data.alerts.map((alert, index) => <div key={index} className="flex items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"><span className="text-sm">{alert.scope === 'total' ? '总预算' : alert.category}</span><Badge tone="danger">超出 <Money cents={alert.over_cents}/></Badge></div>)}</div> : <State kind="empty" message={anyLimit ? '本月未超出已设置的预算' : '尚未设置共同预算'}/> : <p className="m-0 text-sm leading-6 text-muted">成员只看到自己的共担支出。全家是否超预算由组长查看。</p>}</Card>
      </div>
      <Card><SectionTitle title={household ? '共同分类支出' : '我的共担分类支出'}/>{dashboard.data?.category_spend.length ? <div className="grid gap-3 md:grid-cols-2">{dashboard.data.category_spend.map(item => <Link to={'/family/transactions?common_only=true&category=' + encodeURIComponent(item.category)} key={item.category} className="flex justify-between border-b border-line py-2 text-sm hover:text-accent"><span>{item.category}</span><span><Money cents={item.amount_cents}/>{household && item.limit_cents != null && <span className="ml-2 text-muted">/ <Money cents={item.limit_cents}/></span>}</span></Link>)}</div> : <State kind="empty" message="本月没有家庭共担支出"/>}</Card>
      {leader && <Card><SectionTitle title="设置共同预算"/><div className="mb-6 max-w-xs"><AmountInput label="每月总预算" value={total ?? query.data.monthly_budget_cents} onChange={setTotal}/></div><BudgetLimitsEditor items={categories ?? query.data.category_budgets ?? []} observedCategories={dashboard.data?.category_spend.map(item => item.category) ?? []} onChange={setCategories}/><div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={() => setTotal((categories ?? []).reduce((sum, item) => sum + item.limit_cents, 0))}>按分类合计填入总额</Button><Button onClick={save} disabled={busy}>{busy ? '保存中…' : '保存共同预算'}</Button>{message && <span role="status" className={'text-sm ' + (message === '共同预算已保存' ? 'text-success' : 'text-danger')}>{message}</span>}</div></Card>}
    </>}
  </div>
}
