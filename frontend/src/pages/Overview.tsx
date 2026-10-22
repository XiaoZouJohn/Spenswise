import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, json } from '../lib/api'
import type { OverviewData, ScenarioResult } from '../types'
import { Card, SectionTitle, State } from '../components/ui'
import { MetricCard, Money } from '../components/business'
import { Chart } from '../components/Chart'
import { money, today } from '../lib/format'
import { chartColors } from '../lib/tokens'

function Outlook({ dataVersion }: { dataVersion: string }) {
  const query = useQuery({
    queryKey: ['cashflow-outlook', dataVersion, today()],
    queryFn: () => api<ScenarioResult>('/simulate', json('POST', {
      name: '未来 30 天',
      amount_cents: 0,
      purchase_date: today(),
      reserve_cents: 0,
      protected_categories: ['居住', '医疗健康'],
      horizon_days: 30,
    })),
  })

  return <Card>
    <SectionTitle title="未来 30 天"/>
    {query.isLoading ? <State kind="loading" message="正在计算未来收支…"/> :
      query.isError ? <State kind="error" message="未来收支暂时无法显示" retry={() => query.refetch()}/> :
        query.data && <div className="space-y-4">
          <div>
            <div className="text-sm text-muted">预计最低账户余额</div>
            <div className="mt-1 text-3xl font-semibold"><Money cents={query.data.minimum_after_cents}/></div>
          </div>
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
    <header><h1 className="m-0 text-3xl font-semibold">概览</h1></header>
    {query.isLoading ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : data && <>
      <div className="grid-metrics">
        <MetricCard label="账户余额" cents={data.account_balance_cents} detail="期初余额加已记账收支"/>
        <MetricCard label="本月预算剩余" cents={data.budget_remaining_cents} detail="按本月预算和支出计算"/>
        <MetricCard label="本月收入" cents={data.income_cents} tone="positive"/>
        <MetricCard label="本月净支出" cents={data.expense_cents}/>
      </div>
      <div className="two-col">
        <Card>
          <SectionTitle title="分类支出"/>
          {data.category_spend.length ? <>
            <Chart option={{
              color: chartColors,
              tooltip: { trigger: 'item', formatter: (p: any) => p.name + ': ' + money(p.value) },
              series: [{ type: 'pie', radius: ['55%', '76%'], center: ['50%', '52%'], label: { formatter: '{b}' }, data: data.category_spend.map(x => ({ name: x.category, value: x.amount_cents })) }],
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
