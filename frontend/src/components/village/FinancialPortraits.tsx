import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Chart } from '../Chart'
import { api, json } from '../../lib/api'
import { money, nextMonthRange, today } from '../../lib/format'
import { categoryChartColors, chartColors, chartSemanticColors } from '../../lib/tokens'
import type { AccountSnapshot } from '../../lib/familyApi'
import type { OverviewData, PageData, ScenarioResult } from '../../types'
import type { EChartsOption } from 'echarts'

export function LedgerPortrait({ data, rangeLabel, onCategory }: { data: PageData; rangeLabel?: string; onCategory?: (category: string) => void }) {
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 8, right: 60, top: 8, bottom: 20, containLabel: true },
    xAxis: { type: 'value', splitNumber: 3, axisLabel: { hideOverlap: true, formatter: value => money(Math.round(value)).replace('.00', '') }, splitLine: { lineStyle: { color: chartSemanticColors.line } } },
    yAxis: { type: 'category', data: ['净支出', '收入'], axisLine: { show: false }, axisTick: { show: false } },
    tooltip: { trigger: 'axis', valueFormatter: value => money(Number(value)) },
    series: [{ type: 'bar', barWidth: 18, data: [{ value: data.expense_cents ?? 0, itemStyle: { color: chartColors[1] } }, { value: data.income_cents ?? 0, itemStyle: { color: chartColors[0] } }] }],
  }), [data.expense_cents, data.income_cents])
  return <div className="ledger-portrait"><div><span className="workspace-eyebrow">{rangeLabel || '当前筛选范围'}</span><p><strong>{data.total} 笔</strong>记录。统计覆盖全部匹配结果，不限当前页。</p></div><div className="ledger-chart-columns"><Chart option={option} height={180} label="筛选范围内收入与净支出对照"/><div className="ledger-category-list">{data.category_spend?.map(item => <button key={String(item.category)} onClick={() => onCategory?.(String(item.category))}><span>{String(item.category)}</span><strong>{money(Number(item.amount_cents))}</strong></button>)}</div></div><p>收入 {money(data.income_cents ?? 0)} · 净支出 {money(data.expense_cents ?? 0)} · 收支结余 {money(data.net_flow_cents ?? 0)}。退款冲减支出，转账不计收支。</p></div>
}

export function ForecastPortrait() {
  const nextMonth = nextMonthRange()
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/overview') })
  const query = useQuery({
    queryKey: ['cashflow-outlook', today()],
    queryFn: () => api<ScenarioResult>('/simulate', json('POST', {
      name: '下个月',
      amount_cents: 0,
      purchase_date: nextMonth.start,
      reserve_cents: 0,
      protected_categories: ['居住', '医疗健康'],
      use_ai_review: true,
    })),
    staleTime: 5 * 60 * 1000,
  })
  const currentRows = overview.data?.category_spend ?? []
  const forecastRows = query.data?.category_forecast ?? []
  const pieOption = useMemo<EChartsOption>(() => ({
    color: categoryChartColors,
    tooltip: { trigger: 'item', formatter: params => {
      const item = params as { name?: string; value?: number; percent?: number }
      return `${item.name ?? ''}<br/>预计 ${money(Number(item.value ?? 0))} · ${item.percent ?? 0}%`
    } },
    legend: { type: 'scroll', bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: chartSemanticColors.muted, fontSize: 12 } },
    series: [{
      name: '分类预测', type: 'pie', radius: ['46%', '70%'], center: ['50%', '43%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: chartSemanticColors.surface, borderWidth: 3, borderRadius: 5 },
      label: { show: false }, emphasis: { label: { show: true, fontSize: 13, fontWeight: 600 } },
      data: currentRows.map(item => ({ name: item.category, value: item.amount_cents })),
    }],
  }), [currentRows])
  const barOption = useMemo<EChartsOption>(() => ({
    color: categoryChartColors,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: value => money(Number(value)) },
    grid: { left: 8, right: 38, top: 10, bottom: 22, containLabel: true },
    xAxis: { type: 'value', axisLabel: { hideOverlap: true, formatter: value => `¥${Math.round(Number(value) / 100)}` }, splitLine: { lineStyle: { color: chartSemanticColors.line, type: 'dashed' } } },
    yAxis: { type: 'category', inverse: true, data: forecastRows.map(item => item.category), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#335e51', fontSize: 12 } },
    series: [{
      type: 'bar', barMaxWidth: 18,
      data: forecastRows.map((item, index) => ({ value: item.amount_cents, itemStyle: { color: categoryChartColors[index % categoryChartColors.length], borderRadius: [0, 5, 5, 0] } })),
    }],
  }), [forecastRows])
  const result = query.data
  const qualityLabel = result?.data_quality === 'usable' ? '历史数据充足' : result?.data_quality === 'limited' ? '历史数据有限' : '等待更多完整账单'
  const modelLabel = result?.ai_review?.status === 'applied' ? 'DeepSeek 已复核' : '本地预测模型'

  return <section className="forecast-portrait" aria-labelledby="forecast-portrait-title">
    <header className="forecast-portrait-head">
      <div><span className="workspace-eyebrow">{nextMonth.start} 至 {nextMonth.end}</span><h2 id="forecast-portrait-title">下个月收支预测</h2><p>左侧回看本月实际分类，右侧依据完整历史月份推演下个月分类支出。</p></div>
      <span className="forecast-model-tag"><Sparkles size={14}/>{modelLabel}</span>
    </header>
    {query.isPending && <div className="forecast-status" role="status">正在整理历史账单，计算下个月的支出结构…</div>}
    {query.isError && <div className="forecast-status is-error" role="alert"><span>预测暂时无法显示。</span><button onClick={() => query.refetch()}>重新计算</button></div>}
    {result && <>
      <div className="forecast-metrics">
        <div><span>预计下月总支出</span><strong>{result.data_quality === 'insufficient' ? '数据不足' : money(result.expected_expense_cents ?? 0)}</strong><small>固定 + 可变消费</small></div>
        <div><span>预计预算剩余</span><strong>{money(result.expected_budget_remaining_cents ?? 0)}</strong><small>月预算减预计支出</small></div>
        <div><span>支出预测区间</span><strong className="is-range">{money(result.forecast_lower_expense_cents ?? 0)} – {money(result.forecast_upper_expense_cents ?? 0)}</strong><small>历史偏差范围</small></div>
      </div>
      <div className="forecast-chart-grid">
        <article className="forecast-chart-panel"><div className="forecast-chart-title"><div><span>本月分类支出</span><small>{overview.data?.month ?? today().slice(0, 7)} 已发生消费占比</small></div><b>实际 · 扇形图</b></div>{currentRows.length ? <Chart option={pieOption} height={270} label="本月实际分类支出占比扇形图"/> : <div className="forecast-chart-empty">本月还没有可展示的分类支出。</div>}</article>
        <article className="forecast-chart-panel"><div className="forecast-chart-title"><div><span>下月分类预测</span><small>固定支出与日常消费合并展示</small></div><b>预测 · 柱状图</b></div>{forecastRows.length ? <Chart option={barOption} height={Math.max(250, Math.min(390, forecastRows.length * 38 + 70))} label="下个月各分类预测支出柱状图"/> : <div className="forecast-chart-empty">暂时没有可展示的分类预测。</div>}</article>
      </div>
      <footer className="forecast-portrait-foot"><span>{qualityLabel} · 识别周期账单 {result.recurring_bills.length} 项</span><span>预测基于账本历史，不代表实际必然支出</span><Link to="/simulate">调整条件并模拟一笔消费 →</Link></footer>
    </>}
  </section>
}

export function AccountsPortrait({ assets, confirmed, onEdit }: { assets: AccountSnapshot[]; confirmed: boolean; onEdit: (item: AccountSnapshot) => void }) {
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 5, right: 25, top: 12, bottom: 25, containLabel: true },
    xAxis: { type: 'value', splitNumber: 3, axisLabel: { hideOverlap: true, formatter: value => money(Math.round(value)).replace('.00', '') }, splitLine: { lineStyle: { color: chartSemanticColors.line } } },
    yAxis: { type: 'category', inverse: true, data: assets.map(a => `${a.name} · ${a.kind === 'liability' ? '负债' : '资产'}`), axisTick: { show: false }, axisLine: { show: false } },
    tooltip: { trigger: 'axis', valueFormatter: value => money(Math.abs(Number(value))) },
    series: [{ type: 'bar', barMaxWidth: 22, data: assets.map(a => ({ value: a.kind === 'liability' ? -a.balance_cents : a.balance_cents, itemStyle: { color: a.kind === 'liability' ? chartColors[1] : chartColors[0] } })) }],
  }), [assets])
  if (!assets.length) return null
  return <section className="asset-portrait"><div className="asset-portrait-head"><div><h2>已记录的资产与负债</h2><p>逐项展示各账户的最新快照。负债向左，资产向右；完整净资产请核对覆盖范围。</p></div><span className="story-source-tag">{confirmed ? '已确认纳入范围 · 仍需核对快照有效期' : '覆盖范围尚未确认'}</span></div><Chart option={option} height={Math.max(180, Math.min(600, assets.length * 40 + 60))} label="已记录账户的资产负债对照，点击账户编辑快照" onClick={params => { const item = assets[params.dataIndex]; if (item) onEdit(item) }}/></section>
}
