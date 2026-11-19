import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { FamilyCashflowRunway, FamilyDecisionQueue, FamilyGoalTracks, FamilySpendMap, type FamilyDecision } from '../components/family'
import { Money } from '../components/business'
import { Badge, Button, Card, State } from '../components/ui'
import { familyApi } from '../lib/familyApi'
import { day, fullDate, money } from '../lib/format'

export function FamilyDashboardPage() {
  const navigate = useNavigate()
  const dashboard = useQuery({ queryKey: ['family', 'dashboard'], queryFn: () => familyApi.dashboard() })
  const budget = useQuery({ queryKey: ['family', 'budget'], queryFn: familyApi.budget, enabled: dashboard.data?.role === 'leader' })
  const decisions = useMemo<FamilyDecision[]>(() => [
    ...(dashboard.data?.pending_proposals ?? []).map(item => ({ id: `proposal-${item.id}`, title: item.title, description: item.description, date: item.planned_date, amount_cents: item.amount_cents, href: `/family/decisions?proposal=${item.id}`, tone: 'warning' as const })),
    ...(budget.data?.alerts ?? []).map((item, index) => ({ id: `budget-${index}`, title: item.scope === 'total' ? '共同预算已超出上限' : `${item.category}已超出分类预算`, description: `超出 ${money(item.over_cents)}`, href: '/family/budget', tone: 'danger' as const })),
  ], [dashboard.data, budget.data])

  if (dashboard.isLoading) return <div className="page"><State kind="loading" message="正在读取家庭财务…"/></div>
  if (dashboard.isError) return <div className="page"><State kind="error" message="家庭财务暂时无法显示" retry={() => dashboard.refetch()}/></div>
  const data = dashboard.data
  if (!data) return <div className="page"><State kind="empty"/></div>
  const hasEvidence = data.events.length > 0 || data.member_sources.some(item => item.income_cents !== 0 || item.expense_cents !== 0)
  const hasForecastChange = data.events.length > 0 || data.timeline.some(item => item.cumulative_change_cents !== data.timeline[0]?.cumulative_change_cents)
  const least = hasEvidence && hasForecastChange && data.timeline.length ? data.timeline.reduce((a, b) => a.cumulative_change_cents <= b.cumulative_change_cents ? a : b) : null
  return <div className="page family-page space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="m-0 text-3xl font-semibold">{data.role === 'leader' ? '家庭财务' : '我的家庭共担'}</h1><p className="mb-0 mt-2 text-sm text-muted">{data.month} · {data.role === 'leader' ? `已共享 ${data.coverage.shared_members}/${data.coverage.total_members} 位成员` : '仅显示我的账单与计划'}</p></div><Button asChild><Link to="/family/decisions?new=1"><Plus size={17}/>提出共同支出</Link></Button></header>
    <div className="family-insight"><div><span className="block text-sm font-semibold text-accent">未来 30 天</span>{least ? <p className="m-0 mt-1 text-base font-semibold">{day(least.date)} 是累计净现金流变化低点；调整共同计划可查看其影响。</p> : <p className="m-0 mt-1 text-base font-semibold">{hasEvidence ? '按现有账单，暂无可推演的净现金流变化。' : '共享数据尚不足以展示未来现金流。'}</p>}</div><Link className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent" to="/family/decisions">查看方案 <ArrowRight size={16}/></Link></div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)]">
      <FamilyCashflowRunway days={hasEvidence ? data.timeline : []} events={data.events.map((item, index) => ({ id: `${item.date}-${index}`, date: item.date, label: item.title, amount_cents: item.amount_cents, kind: item.kind, source_ids: item.source_ids }))} assumptions={data.forecast_assumptions} onEvent={event => navigate('/family/transactions?ids=' + (event.source_ids ?? []).join(','))}/>
      <FamilyDecisionQueue decisions={decisions}/>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]"><FamilySpendMap title={data.role === 'leader' ? '本月共同支出结构' : '我的共担支出去向'} categories={data.category_spend.map(item => ({ category: item.category, amount_cents: item.amount_cents, budget_cents: item.limit_cents }))}/><FamilyGoalTracks goals={data.goals}/></div>
    {data.role === 'leader' && <Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="m-0 text-lg font-semibold">成员收支来源</h2><p className="mb-0 mt-1 text-sm text-muted">仅包含成员同意共享的日期和账单；点击成员查看来源。</p></div><Badge>{data.net_worth_covered && data.net_worth_cents != null ? <>已覆盖财富 <Money cents={data.net_worth_cents}/></> : '家庭财富尚未完整覆盖'}</Badge></div>
      {data.member_sources.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">{data.member_sources.map(item => <Link to={`/family/transactions?user_id=${item.user_id}`} key={item.user_id} className="family-member-source"><strong>{item.display_name}</strong><span>收入 <Money cents={item.income_cents}/></span><span>支出 <Money cents={item.expense_cents}/></span><ArrowRight size={16}/></Link>)}</div> : <State kind="empty" message="还没有共享的成员收支"/>}
      <div className="mt-5 border-t border-line pt-4"><h3 className="m-0 text-base font-semibold">财富覆盖范围</h3><p className="mb-0 mt-1 text-sm text-muted">家庭财富来自成员同意共享的资产记录。共有账户使用相同代号；金额或日期不一致时，请先核对。</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{data.coverage_details.map(item => <div key={item.user_id} className="rounded-control border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><strong>{item.display_name}</strong><Badge tone={item.confirmed && item.included_count > 0 && !item.reason ? 'success' : 'warning'}>{item.reason ? '需核对' : item.confirmed && item.included_count > 0 ? '已纳入' : '未覆盖'}</Badge></div><p className="mb-0 mt-2 text-muted">{item.included_count > 0 ? `${item.included_count} 项资产/负债 · 最近估值 ${item.latest_as_of ? fullDate(item.latest_as_of) : '未标注'}` : item.reason || '尚无纳入的资产快照'}</p><p className="mb-0 mt-1 text-muted">估值有效期 {item.valid_days} 天</p>{item.included_count > 0 && item.reason && <p className="mb-0 mt-1 text-muted">{item.reason}</p>}</div>)}</div>
      </div></Card>}
  </div>
}
