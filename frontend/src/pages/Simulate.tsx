import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AmountInput, MetricCard, ScenarioComparison } from '../components/business'
import { Chart } from '../components/Chart'
import { Badge, Button, Card, SectionTitle, State } from '../components/ui'
import { api, json } from '../lib/api'
import { money, nextMonthRange } from '../lib/format'
import { chartColors } from '../lib/tokens'
import type { ScenarioInput, ScenarioResult } from '../types'
import { getVillageOverview, safeEvidenceHref } from '../lib/village'
import { useWorkspaceDraft } from '../lib/useWorkspaceDraft'
import { ConsumptionReview } from '../components/village/ConsumptionReview'

const categories = ['餐饮', '交通', '购物', '居住', '医疗健康', '娱乐', '旅行', '通讯', '教育', '日用品', '人情往来']

export function Simulate() {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'simulation' ? 'simulation' : 'spending'
  return <div className="page market-page"><header className="workspace-title"><div><p>集市 / 消费与选择</p><h1>集市</h1></div></header><nav className="building-tabs" aria-label="集市功能">{(['spending', 'simulation'] as const).map((item, index) => <button key={item} aria-pressed={view === item} onClick={() => { const next = new URLSearchParams(params); next.set('view', item); next.delete('category'); setParams(next) }}>{['消费回看', '消费模拟'][index]}</button>)}</nav>{view === 'spending' ? <ConsumptionReview/> : <SimulationWorkspace key={params.get('category') || ''}/>}</div>
}

function SimulationWorkspace() {
  const [params] = useSearchParams()
  const sourceCategory = params.get('category') || ''
  const sourceHref = params.get('from')
  const nextMonth = nextMonthRange()
  const [input, setInput] = useWorkspaceDraft<ScenarioInput>(`market-${sourceCategory}`, {
    name: sourceCategory ? `${sourceCategory.slice(0, 50)} · 下月方案` : '下个月消费方案',
    amount_cents: 0,
    purchase_date: nextMonth.start,
    reserve_cents: 50000,
    protected_categories: ['居住', '医疗健康'],
    use_ai_review: true,
  })
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [resultInput, setResultInput] = useState('')
  const [viewingSaved, setViewingSaved] = useState(false)
  const overview = useQuery({ queryKey: ['overview'], queryFn: getVillageOverview })
  const stale = !!result && (viewingSaved || resultInput !== JSON.stringify(input) || (!!overview.data && result.data_version !== overview.data.data_version))
  const [message, setMessage] = useState('')
  const mutation = useMutation({
    mutationFn: (value: ScenarioInput) => api<ScenarioResult>('/simulate', json('POST', value)),
    onSuccess: (data, variables) => { setResult(data); setResultInput(JSON.stringify(variables)); setViewingSaved(false) },
  })
  const save = useMutation({
    mutationFn: () => api<{ id: number }>('/scenarios', json('POST', input)),
    onSuccess: () => { setMessage('方案已保存'); saved.refetch() },
  })
  const saved = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => api<{ id: number; name: string; result: ScenarioResult }[]>('/scenarios'),
  })
  const option = useMemo(() => result ? {
    color: [chartColors[3], chartColors[0], chartColors[2], chartColors[4]],
    tooltip: { trigger: 'axis' },
    legend: { data: ['购买前', '购买后', '区间下界', '区间上界'] },
    grid: { left: 70, right: 25, top: 40, bottom: 35 },
    xAxis: { type: 'category', data: result.timeline.map(item => item.date.slice(5)) },
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `¥${Math.round(value / 100)}` } },
    series: [
      { name: '购买前', type: 'line', showSymbol: false, data: result.timeline.map(item => item.before_cents) },
      { name: '购买后', type: 'line', showSymbol: false, data: result.timeline.map(item => item.after_cents) },
      { name: '区间下界', type: 'line', showSymbol: false, lineStyle: { type: 'dashed' }, data: result.timeline.map(item => item.lower_cents) },
      { name: '区间上界', type: 'line', showSymbol: false, lineStyle: { type: 'dashed' }, data: result.timeline.map(item => item.upper_cents) },
    ],
  } as import('echarts').EChartsOption : undefined, [result])

  return <div className="page market-page space-y-6">
    <header>
      <p className="mb-1 text-sm text-muted">下月决策工作区</p>
      <h1 className="m-0 text-3xl font-semibold">消费模拟</h1>
      <p className="text-sm text-muted">模拟区间固定为 {nextMonth.start} 至 {nextMonth.end}，即下个月第一天到最后一天。</p>
    </header>
    {sourceCategory && <div className="scenario-source"><span>来自账房：{sourceCategory}。调整计划金额，查看下一步的影响。</span>{sourceHref && <Link to={safeEvidenceHref(sourceHref)}>返回来源账册 →</Link>}</div>}
    <div className="market-layout"><aside className="market-conditions"><div className="two-col">
      <Card>
        <SectionTitle title="下个月模拟条件"/>
        <div className="mb-4 rounded-control bg-canvas p-3 text-sm text-muted">自然月周期：{nextMonth.start} — {nextMonth.end}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field"><label>方案名称</label><input value={input.name} onChange={event => setInput({ ...input, name: event.target.value })}/></div>
          <div className="field"><label>计划消费日期</label><input type="date" min={nextMonth.start} max={nextMonth.end} value={input.purchase_date} onChange={event => setInput({ ...input, purchase_date: event.target.value })}/></div>
          <AmountInput label="准备额外消费的金额" value={input.amount_cents} onChange={value => setInput({ ...input, amount_cents: value })}/>
          <AmountInput label="月底最低保留余额" value={input.reserve_cents} onChange={value => setInput({ ...input, reserve_cents: value })}/>
        </div>
        <div className="mt-5 text-sm font-semibold">不可削减类别</div>
        <div className="mt-3 flex flex-wrap gap-2">{categories.map(item => <button
          key={item}
          type="button"
          className={`rounded-control border px-3 py-2 text-xs ${input.protected_categories.includes(item) ? 'border-accent bg-accent text-white' : 'border-line'}`}
          onClick={() => setInput({ ...input, protected_categories: input.protected_categories.includes(item) ? input.protected_categories.filter(value => value !== item) : [...input.protected_categories, item] })}
        >{item}</button>)}</div>
        <div className="mt-6 flex gap-2"><Button onClick={() => mutation.mutate(input)} disabled={mutation.isPending}>{mutation.isPending ? '计算中…' : '运行下月模拟'}</Button></div>
        {mutation.isError && <p className="text-sm text-danger">{mutation.error.message}</p>}
        {message && <p role="status" className="text-sm text-success">{message}</p>}
      </Card>
      <Card>
        <SectionTitle title="已保存方案"/>
        {saved.isLoading ? <State kind="loading"/> : saved.isError ? <State kind="error" retry={() => saved.refetch()}/> : saved.data?.length ? <div className="space-y-2">{saved.data.map(item => <button key={item.id} className="flex w-full items-center justify-between rounded-control border border-line p-3 text-left text-sm hover:bg-canvas" onClick={() => { setResult(item.result); setViewingSaved(true); setMessage(`正在查看「${item.name}」`) }}><span>{item.name}</span><span>{money(item.result.minimum_after_cents)}</span></button>)}</div> : <State kind="empty" message="还没有保存的方案"/>}
      </Card>
    </div>
    </aside><section className="market-results"><header className="market-results-head"><h2>方案结果</h2><Button variant="secondary" onClick={() => save.mutate()} disabled={!result || stale || mutation.isPending || save.isPending}>保存方案</Button></header>
    {stale && <p role="status" className="scenario-source">{viewingSaved ? '正在查看历史方案，当前条件独立显示。运行模拟可生成新结果。' : '条件已修改，以下为上次计算结果，请重新运行。'}</p>}
    {save.isError && <p role="alert" className="text-danger">保存失败，请重试。</p>}
    {!result && !mutation.isPending && <State kind="empty" message="填写条件后运行模拟，比较计划对下个月的影响"/>}
    {mutation.isPending && <State kind="loading" message="正在计算下个月现金流与约束方案…"/>}
    {result && <>
      <div className="grid-metrics">
        <MetricCard label="预计下月总支出" cents={result.expected_expense_cents ?? 0} detail="不含下面输入的额外消费"/>
        <MetricCard label="加入额外消费后" cents={result.expected_expense_after_purchase_cents ?? 0} detail="历史预测加计划消费"/>
        <MetricCard label="预计预算剩余" cents={result.expected_budget_remaining_cents ?? 0} detail="月预算减预计总支出"/>
        <MetricCard label="预测区间下限" cents={result.forecast_lower_expense_cents ?? 0} detail={`上限 ${money(result.forecast_upper_expense_cents ?? 0)}`}/>
      </div>
      {result.ai_review && <Card><div className="flex flex-wrap items-center gap-3"><Badge tone={result.ai_review.status === 'applied' ? 'success' : 'neutral'}>{result.ai_review.status === 'applied' ? 'DeepSeek 已复核' : '本地模型预测'}</Badge><span className="text-sm text-muted">{result.ai_review.reason}</span></div></Card>}
      <ScenarioComparison before={result.timeline.at(-1)?.before_cents || 0} after={result.timeline.at(-1)?.after_cents || 0} minimum={result.minimum_after_cents} reserve={result.reserve_cents}/>
      <Card>
        <SectionTitle title={`下个月购买前后现金流（${result.period_start || result.timeline.at(0)?.date} 至 ${result.period_end || result.timeline.at(-1)?.date}）`} action={<Badge tone={result.optimization.feasible ? 'success' : 'danger'}>{result.optimization.feasible ? '存在可行方案' : '无可行方案'}</Badge>}/>
        {option && <Chart option={option}/>}<Link className="mt-3 inline-block text-sm font-semibold text-accent" to={`/ledger?ids=${result.source_transaction_ids.slice(0, 200).join(',')}`}>查看计算依据的账单 →</Link>
      </Card>
      <div className="two-col">
        <Card><SectionTitle title="调整建议"/>{result.required_saving_cents === 0 ? <p className="text-sm">无需削减其他类别，月底保留目标已满足。</p> : result.optimization.feasible ? <><p className="text-sm">下个月需减少 {money(result.required_saving_cents)} 的支出。</p>{result.optimization.cuts.map(item => <div key={item.category} className="flex justify-between border-b border-line py-2 text-sm"><span>{item.category}</span><span>{money(item.amount_cents)}</span></div>)}</> : <State kind="empty" message="在保护类别与削减上限下无法满足月底保留余额。请降低消费、延后到其他月份或调整约束。"/>}</Card>
        <Card><SectionTitle title="预计下月周期账单"/>{result.recurring_bills.length ? result.recurring_bills.map((item, index) => <div key={index} className="flex justify-between border-b border-line py-2 text-sm"><Link className="text-accent" to={`/ledger?ids=${item.source_ids.join(',')}`}>{item.date} · {item.merchant}</Link><span>{money(item.amount_cents)}</span></div>) : <State kind="empty" message="下个月没有识别出周期账单"/>}</Card>
      </div>
    </>}</section></div>
  </div>
}
