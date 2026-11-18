import { useMemo } from 'react'
import { Chart } from '../Chart'
import { money } from '../../lib/format'
import { chartColors, chartSemanticColors } from '../../lib/tokens'
import type { AccountSnapshot } from '../../lib/familyApi'
import type { PageData } from '../../types'
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
