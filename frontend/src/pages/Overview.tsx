import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, json } from '../lib/api'
import type { OverviewData, ScenarioResult } from '../types'
import { Badge, Card, SectionTitle, State } from '../components/ui'
import { MetricCard, Money } from '../components/business'
import { ForecastEvidence } from '../components/ForecastOptions'
import { Chart } from '../components/Chart'
import { money, nextMonthRange, today } from '../lib/format'
import { categoryChartColors } from '../lib/tokens'

function Outlook({ dataVersion }: { dataVersion: string }) {
  const nextMonth = nextMonthRange()
  const query = useQuery({
    queryKey: ['cashflow-outlook', dataVersion, today()],
    queryFn: () => api<ScenarioResult>('/simulate', json('POST', {
      name: '下个月',
      amount_cents: 0,
      purchase_date: nextMonth.start,
      reserve_cents: 0,
      protected_categories: ['居住', '医疗健康'],
      use_ai_review: true,
    })),
  })

  return <Card>
    <SectionTitle title="下个月收支预测"/>
    {query.isLoading ? <State kind="loading" message="正在计算未来收支…"/> :
      query.isError ? <State kind="error" message="未来收支暂时无法显示" retry={() => query.refetch()}/> :
        query.data && <div className="space-y-4">
          <ForecastEvidence result={query.data}/>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-control bg-canvas p-3">
              <div className="text-sm text-muted">预计总支出</div>
              <div className="mt-1 text-2xl font-semibold">{query.data.data_quality === "insufficient" ? "暂无法可靠估计" : <Money cents={query.data.expected_expense_cents ?? 0}/>}</div>
            </div>
            <div className="rounded-control bg-canvas p-3">
              <div className="text-sm text-muted">预计预算剩余</div>
              <div className="mt-1 text-2xl font-semibold"><Money cents={query.data.expected_budget_remaining_cents ?? 0}/></div>
            </div>
            <div className="rounded-control bg-canvas p-3">
              <div className="text-sm text-muted">最低累计净现金流</div>
              <div className="mt-1 text-2xl font-semibold"><Money cents={query.data.minimum_after_cents}/></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{nextMonth.start} 至 {nextMonth.end}</span>
            <span>·</span>
            <span>支出区间 {money(query.data.forecast_lower_expense_cents ?? 0)}–{money(query.data.forecast_upper_expense_cents ?? 0)}</span>
            <Badge tone={query.data.ai_review?.status === 'applied' ? 'success' : 'neutral'}>{query.data.ai_review?.status === 'applied' ? 'DeepSeek 已复核' : '本地模型'}</Badge>
          </div>
          {query.data.ai_review?.reason && <p className="m-0 text-sm leading-6 text-muted">{query.data.ai_review.reason}</p>}
          <div className="border-t border-line pt-4">
            <div className="mb-2 text-sm font-semibold">待付周期账单 · {query.data.recurring_bills.length} 项</div>
            {query.data.recurring_bills.length ? query.data.recurring_bills.slice(0, 3).map((bill, index) =>
              <div key={bill.date + bill.merchant + index} className="flex justify-between gap-3 py-2 text-sm">
                <Link className="min-w-0 truncate text-accent" to={'/ledger?ids=' + bill.source_ids.join(',')}>{bill.date} · {bill.merchant}</Link>
                <Money cents={bill.amount_cents}/>
              </div>) : <p className="text-sm text-muted">暂无待付周期账单</p>}
          </div>
          <Link className="inline-block text-sm font-semibold text-accent" to="/simulate">模拟一笔消费 →</Link>
        </div>}
  </Card>
}

export function Overview() {
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/overview') })
  const data = query.data

  return <div className="page space-y-6">
    <header><h1 className="m-0 text-3xl font-semibold">首页</h1></header>
    {query.isLoading ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : data && <>
      <div className="grid-metrics">
        <MetricCard label="本月预算剩余" cents={data.budget_remaining_cents} detail="按本月预算和支出计算"/>
        <MetricCard label="本月收入" cents={data.income_cents} tone="positive"/>
        <MetricCard label="本月净支出" cents={data.expense_cents}/>
      </div>
      <div className="two-col">
        <Card>
          <SectionTitle title="分类支出"/>
          {data.category_spend.length ? <>
            <Chart option={{
              color: categoryChartColors,
              tooltip: { trigger: 'item', formatter: (p: any) => p.name + ': ' + money(p.value) },
              series: [{ type: 'pie', radius: ['48%', '76%'], center: ['50%', '52%'], padAngle: 2, itemStyle: { borderColor: '#ffffff', borderWidth: 3, borderRadius: 6 }, label: { formatter: '{b}', color: '#334155' }, data: data.category_spend.map(x => ({ name: x.category, value: x.amount_cents })) }],
            }} onClick={p => navigate('/ledger?category=' + encodeURIComponent(String(p.name)))}/>
            <div className="grid gap-2">{data.category_spend.map(item =>
              <button key={item.category} className="flex justify-between rounded-control px-2 py-2 text-sm hover:bg-canvas" onClick={() => navigate('/ledger?category=' + encodeURIComponent(item.category))}>
                <span>{item.category}</span><Money cents={item.amount_cents}/>
              </button>)}</div>
          </> : <State kind="empty" message="本月还没有支出"/>}
        </Card>
        <div className="space-y-6">
          <Outlook dataVersion={data.data_version}/>
          <Card>
            <SectionTitle title="本月账本"/>
            <div className="text-3xl font-semibold">{data.transaction_count}</div>
            <div className="mt-1 text-sm text-muted">笔本月账单</div>
            <Link className="mt-4 inline-block text-sm font-semibold text-accent" to="/ledger">查看账本 →</Link>
          </Card>
        </div>
      </div>
    </>}
  </div>
}
