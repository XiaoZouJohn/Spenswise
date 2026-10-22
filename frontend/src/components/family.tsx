import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import { Chart } from './Chart'
import { Money, DateLabel } from './business'
import { Badge, Button, Card, SectionTitle, State } from './ui'
import { day, fullDate, money } from '../lib/format'
import { chartColors, chartSemanticColors } from '../lib/tokens'
import type { ProposalPreview } from '../lib/familyApi'

export type CashflowDay = { date: string; cumulative_change_cents: number }
export type CashflowEvent = { id: string | number; date: string; label: string; amount_cents: number; kind: string; source_ids?: number[] }
export type FamilyCategory = { category: string; amount_cents: number; budget_cents?: number | null }
export type FamilyGoal = { id: number | string; name: string; target_cents: number; current_cents: number; target_date?: string | null }
export type FamilyDecision = { id: number | string; title: string; description?: string; date?: string; amount_cents?: number; href: string; tone?: 'neutral' | 'warning' | 'danger' }

export function FamilyCashflowRunway({ days, events, assumptions, onEvent }: { days: CashflowDay[]; events: CashflowEvent[]; assumptions?: string[]; onEvent?: (item: CashflowEvent) => void }) {
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 260,
    grid: { left: 12, right: 22, top: 28, bottom: 38, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: value => money(Number(value) * 100) },
    xAxis: { type: 'category', data: days.map(item => item.date), axisLabel: { formatter: value => day(String(value)), hideOverlap: true }, axisLine: { lineStyle: { color: chartSemanticColors.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: value => money(Math.round(Number(value) * 100)) }, splitLine: { lineStyle: { color: chartSemanticColors.line } } },
    series: [
      { name: '累计净现金流变化', type: 'line', showSymbol: days.length <= 12, symbolSize: 7, smooth: false, lineStyle: { width: 3, color: chartColors[0] }, itemStyle: { color: chartColors[0] }, areaStyle: { color: chartSemanticColors.area }, data: days.map(item => item.cumulative_change_cents / 100) },
    ],
  }), [days])
  const noMovement = days.length > 0 && events.length === 0 && days.every(item => item.cumulative_change_cents === days[0].cumulative_change_cents)
  const low = days.length && !noMovement ? Math.min(...days.map(item => item.cumulative_change_cents)) : null

  return <Card className="min-w-0">
    <SectionTitle title="未来现金流" action={low == null ? undefined : <span className="text-sm text-muted">累计变化低点 <strong className="ml-1 text-ink"><Money cents={low}/></strong></span>}/>
    {days.length && !noMovement ? <>
      <p className="mb-4 text-sm text-muted">此图表示累计净现金流变化，不代表账户余额；未来收入未计入。点击事件可核对来源账单。</p>
      <Chart option={option} height={300}/>
      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-2 text-sm font-semibold">关键事件</div>
        {events.length ? <div className="grid gap-1 md:grid-cols-2">{events.map(item => {
          const content = <><span className="flex min-w-0 items-center gap-2"><span className={'family-event-mark family-event-' + item.kind}/><DateLabel value={item.date}/><span className="truncate">{item.label}</span></span><Money cents={item.amount_cents}/></>
          return onEvent && item.source_ids?.length ? <button key={item.id} type="button" className="family-event-row" onClick={() => onEvent(item)} aria-label={`查看${item.label}来源`}>{content}</button> : <div key={item.id} className="family-event-row">{content}</div>
        })}</div> : <p className="text-sm text-muted">目前没有待处理的收入或账单事件。</p>}
      </div>
      {!!assumptions?.length && <p className="mb-0 mt-3 text-sm text-muted">计算假设：{assumptions.join('；')}</p>}
    </> : <State kind="empty" message={noMovement ? '按现有账单，未来 30 天暂无可推演的净现金流变化' : '尚无足够的共享交易数据，无法绘制现金流'}/>}
  </Card>
}

export function FamilyDecisionQueue({ decisions }: { decisions: FamilyDecision[] }) {
  return <Card className="min-w-0"><SectionTitle title="待一起决定" action={<Link className="text-sm font-semibold text-accent" to="/family/decisions">全部事项 →</Link>}/>
    {decisions.length ? <div className="divide-y divide-line">{decisions.map(item => <Link key={item.id} to={item.href} className="family-decision block py-4 first:pt-0 last:pb-0">
      <div className="mb-2 flex items-center justify-between gap-3"><Badge tone={item.tone ?? 'neutral'}>{item.date ? day(item.date) : '待处理'}</Badge>{item.amount_cents != null && <span className="text-sm font-semibold"><Money cents={item.amount_cents}/></span>}</div>
      <h3 className="m-0 text-base font-semibold">{item.title}</h3>{item.description && <p className="mb-0 mt-1 text-sm text-muted">{item.description}</p>}
    </Link>)}</div> : <State kind="empty" message="目前没有需要共同决定的事项"/>}
  </Card>
}

export function FamilySpendMap({ categories, title = '本月钱的去向' }: { categories: FamilyCategory[]; title?: string }) {
  const navigate = useNavigate()
  const items = categories.filter(item => item.amount_cents > 0)
  const option = useMemo<EChartsOption>(() => ({
    color: chartColors,
    tooltip: { formatter: (params: any) => `${params.name}<br/>支出 ${money(Number(params.value))}` },
    series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, formatter: '{b}', fontSize: 14, fontWeight: 600 }, upperLabel: { show: false }, itemStyle: { borderColor: chartSemanticColors.surface, borderWidth: 3, gapWidth: 2 }, data: items.map((item, index) => ({ name: item.category, value: item.amount_cents, itemStyle: { color: item.budget_cents != null && item.amount_cents > item.budget_cents ? chartSemanticColors.danger : chartColors[index % chartColors.length] } })) }],
  }), [items])
  return <Card className="min-w-0"><SectionTitle title={title}/>
    <p className="mb-3 text-sm text-muted">面积对应已发生支出；红色表示超过该分类预算。</p>
    {items.length ? <><Chart option={option} height={220} onClick={params => { if (params.name) navigate('/family/transactions?common_only=true&category=' + encodeURIComponent(params.name)) }}/>
      <div className="mt-3 grid gap-1">{items.map(item => <Link key={item.category} to={'/family/transactions?common_only=true&category=' + encodeURIComponent(item.category)} className="flex items-center justify-between rounded-control px-2 py-1.5 text-sm hover:bg-canvas"><span>{item.category}</span><span className="font-semibold"><Money cents={item.amount_cents}/></span></Link>)}</div>
    </> : <State kind="empty" message="本月还没有可纳入家庭统计的支出"/>}
  </Card>
}

export function FamilyGoalTracks({ goals, manageHref = '/family/goals' }: { goals: FamilyGoal[]; manageHref?: string }) {
  return <Card className="min-w-0"><SectionTitle title="共同目标" action={<Link className="text-sm font-semibold text-accent" to={manageHref}>管理目标 →</Link>}/>
    {goals.length ? <div className="space-y-6">{goals.map(goal => {
      const percentage = goal.target_cents > 0 ? Math.min(100, Math.max(0, goal.current_cents / goal.target_cents * 100)) : 0
      return <div key={goal.id}><div className="mb-2 flex items-center justify-between gap-4"><h3 className="m-0 text-base font-semibold">{goal.name}</h3><span className="text-sm text-muted">{goal.target_date ? `目标 ${fullDate(goal.target_date)}` : '未设目标日期'}</span></div>
        <div className="family-goal-track" role="progressbar" aria-valuemin={0} aria-valuemax={goal.target_cents} aria-valuenow={goal.current_cents} aria-label={`${goal.name}进度`}><div style={{ width: `${percentage}%` }}/></div>
        <div className="mt-2 flex justify-between text-sm"><span>已积累 <strong><Money cents={goal.current_cents}/></strong></span><span className="text-muted">目标 <Money cents={goal.target_cents}/></span></div>
      </div>
    })}</div> : <State kind="empty" message="还没有共同目标"/>}
  </Card>
}

export function FamilyPendingAccess({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <Card className="family-empty mx-auto max-w-2xl"><div className="family-empty-mark" aria-hidden="true">家</div><h1 className="mb-3 mt-0 text-2xl font-semibold">开启家庭空间</h1><p className="m-0 max-w-lg text-base leading-7 text-muted">创建家庭或接受邀请后，可以在授权范围内查看共同收支、规划支出和管理预算。</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={onCreate}>创建家庭</Button><Button variant="secondary" onClick={onJoin}>输入邀请码</Button></div></Card>
}

export function FamilyScenarioPreview({ preview }: { preview: ProposalPreview }) {
  const balance = preview.opening_balance_cents != null
  const option = useMemo<EChartsOption>(() => ({
    color: [chartSemanticColors.muted, chartColors[0]],
    legend: { bottom: 0, data: ['原计划', '加入提案后'] },
    tooltip: { trigger: 'axis', valueFormatter: value => money(Number(value) * 100) },
    grid: { left: 12, right: 20, top: 18, bottom: 55, containLabel: true },
    xAxis: { type: 'category', data: preview.timeline.map(item => item.date), axisLabel: { formatter: value => day(String(value)), hideOverlap: true }, axisLine: { lineStyle: { color: chartSemanticColors.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: value => money(Math.round(Number(value) * 100)) }, splitLine: { lineStyle: { color: chartSemanticColors.line } } },
    series: [
      { type: 'line', name: '原计划', data: preview.timeline.map(item => item.before_cents / 100), showSymbol: false, smooth: false, lineStyle: { width: 2, type: 'dashed' } },
      { type: 'line', name: '加入提案后', data: preview.timeline.map(item => item.after_cents / 100), showSymbol: false, smooth: false, lineStyle: { width: 3 } },
    ],
  }), [preview.timeline])
  return <div className="space-y-3">{preview.scope === 'self' && <p className="m-0 border-l-2 border-warning bg-canvas px-3 py-2 text-sm">仅基于本人可见的共担账单，不代表家庭全貌。</p>}<div className="grid gap-3 sm:grid-cols-2"><div className="family-preview-number"><span>{balance ? '原计划最低余额' : '原计划累计变化低点'}</span><strong>{preview.minimum_before_cents == null ? '暂无可计算数据' : <Money cents={preview.minimum_before_cents}/>}</strong></div><div className="family-preview-number"><span>{balance ? '加入提案后最低余额' : '加入提案后累计变化低点'}</span><strong>{preview.minimum_after_cents == null ? '暂无可计算数据' : <Money cents={preview.minimum_after_cents}/>}</strong></div></div>
    {preview.timeline.length ? <Chart option={option} height={300}/> : <State kind="empty" message="没有可对比的未来现金流"/>}
    {preview.goal_impact && <div className="rounded-control border border-line p-4 text-sm"><strong className="block text-base">储蓄目标日期影响</strong><div className="mt-2 flex flex-wrap gap-x-6 gap-y-1"><span>原预计达成：{preview.goal_impact.estimated_before_date ? fullDate(preview.goal_impact.estimated_before_date) : '暂无可估日期'}</span><span>加入提案后：{preview.goal_impact.estimated_after_date ? fullDate(preview.goal_impact.estimated_after_date) : '暂无可估日期'}</span></div>{preview.goal_impact.delay_months != null && <p className="mb-0 mt-2 text-muted">预计推迟 {preview.goal_impact.delay_months} 个月。估算基于目标已记录金额及每月投入。</p>}</div>}
    <p className="m-0 text-sm leading-6 text-muted">{balance ? '曲线使用已授权账户起点计算余额。' : '缺少可信账户起点，曲线展示累计预计净现金流变化，不代表账户余额。'}未来收入未计入。</p>
    {!!preview.forecast_assumptions?.length && <p className="m-0 text-sm leading-6 text-muted">计算假设：{preview.forecast_assumptions.join('；')}</p>}
  </div>
}
