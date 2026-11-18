import type { ScenarioInput, ScenarioResult, SettingsData } from '../types'
import { today } from '../lib/format'
import { AmountInput, Money } from './business'
import { Badge, Button, Disclosure } from './ui'

export function ForecastOptions({ value, onChange, categories }: {
  value: ScenarioInput; onChange: (value: ScenarioInput) => void; categories: string[]
}) {
  const events = value.cash_events ?? []
  const rules = value.category_constraints ?? []
  return <div className="forecast-options mt-5 space-y-5">
    <Disclosure title="余额与确认收支" description="填写后可试算账户余额；不填则展示净现金流变化">
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={value.balance_cents != null} onChange={e => onChange({ ...value, balance_cents: e.target.checked ? 0 : null, balance_date: e.target.checked ? today() : null })}/>使用余额快照</label>
      {value.balance_cents != null && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AmountInput label="快照日结束时的余额" value={value.balance_cents} onChange={balance_cents => onChange({ ...value, balance_cents })}/>
        <div className="field"><label>快照日期</label><input aria-label="快照日期" type="date" max={today()} value={value.balance_date ?? ''} onChange={e => onChange({ ...value, balance_date: e.target.value })}/></div>
      </div>}
      <p className="text-xs text-muted">仅添加尚未入账的确认收支。额外支出不要重复填写日常消费、已识别账单或上面的计划购买。</p>
      {events.map((item, i) => <div key={i} className="mb-3 grid gap-2 rounded-control border border-line p-3 sm:grid-cols-2">
        <input aria-label={`收支日期 ${i + 1}`} type="date" value={item.date} onChange={e => onChange({ ...value, cash_events: events.map((x, j) => j === i ? { ...x, date: e.target.value } : x) })}/>
        <select aria-label={`收支类型 ${i + 1}`} value={item.kind} onChange={e => onChange({ ...value, cash_events: events.map((x, j) => j === i ? { ...x, kind: e.target.value as 'income' | 'expense' } : x) })}><option value="income">确认收入</option><option value="expense">额外支出</option></select>
        <AmountInput label={`收支金额 ${i + 1}`} value={item.amount_cents} onChange={amount_cents => onChange({ ...value, cash_events: events.map((x, j) => j === i ? { ...x, amount_cents } : x) })}/>
        <Button variant="secondary" onClick={() => onChange({ ...value, cash_events: events.filter((_, j) => i !== j) })}>删除收支</Button>
      </div>)}
      <Button variant="secondary" onClick={() => onChange({ ...value, cash_events: [...events, { date: value.purchase_date, kind: 'income', amount_cents: 0 }] })}>添加确认收支</Button>
    </Disclosure>
    <Disclosure title="分类削减偏好" description="默认最多削减 40%；保护类别始终不削减">
      <p className="text-xs text-muted">最低保留是该分类可变消费的最低额度；影响权重越大，越优先保留该分类。固定账单不参与削减。</p>
      {rules.map((item, i) => <div key={item.category} className="mb-3 grid gap-3 rounded-control border border-line p-3 sm:grid-cols-2">
        <strong className="text-sm">{item.category}</strong>
        <AmountInput label={`${item.category}最低保留`} value={item.minimum_cents ?? 0} onChange={minimum_cents => onChange({ ...value, category_constraints: rules.map((x, j) => j === i ? { ...x, minimum_cents } : x) })}/>
        <div className="field"><label>最多削减（%）</label><input aria-label={`${item.category}削减上限`} type="number" min="0" max="100" value={item.max_cut_percent ?? 40} onChange={e => onChange({ ...value, category_constraints: rules.map((x, j) => j === i ? { ...x, max_cut_percent: Number(e.target.value) } : x) })}/></div>
        <div className="field"><label>影响权重（1–100）</label><input aria-label={`${item.category}影响权重`} type="number" min="1" max="100" value={item.disruption_weight ?? 1} onChange={e => onChange({ ...value, category_constraints: rules.map((x, j) => j === i ? { ...x, disruption_weight: Number(e.target.value) } : x) })}/></div>
        <Button variant="secondary" onClick={() => onChange({ ...value, category_constraints: rules.filter((_, j) => i !== j) })}>恢复默认约束</Button>
      </div>)}
      <select aria-label="添加分类约束" value="" onChange={e => { if (e.target.value) onChange({ ...value, category_constraints: [...rules, { category: e.target.value, minimum_cents: 0, max_cut_percent: 40, disruption_weight: 1 }] }) }}><option value="">选择要自定义的分类</option>{categories.filter(c => !rules.some(r => r.category === c)).map(c => <option key={c}>{c}</option>)}</select>
    </Disclosure>
  </div>
}

export function ForecastEvidence({ result }: { result: ScenarioResult }) {
  return <div className="forecast-evidence space-y-2 text-sm" data-testid="forecast-evidence">
    <Badge tone={result.data_quality === 'usable' ? 'neutral' : 'warning'}>{result.data_quality === 'insufficient' ? '历史不足 · 仅供试算' : result.data_quality === 'limited' ? '历史较少' : result.data_quality === 'usable' ? '历史预测' : '旧版结果 · 建议重新试算'}</Badge>
    {result.fixed_expense_cents != null && <p>预计支出构成：固定账单 <Money cents={result.fixed_expense_cents}/>，可变消费 <Money cents={result.variable_expense_cents ?? 0}/>，额外支出 <Money cents={result.planned_expense_cents ?? 0}/>。可变消费中 AI 调整 <Money cents={result.ai_delta_cents ?? 0}/>。</p>}
    <p className="text-muted">历史偏差范围尚未校准为置信区间。{result.coverage_status === 'confirmed' ? '已使用你确认的完整记录区间。' : '历史完整性尚未确认，空白月份未按零消费处理。'}</p>
    {result.warnings?.map(warning => <p className="text-muted" key={warning}>{warning}</p>)}
  </div>
}

export function HistoryCoverageEditor({ value, onChange }: {
  value: NonNullable<SettingsData['history_coverage']>; onChange: (value: NonNullable<SettingsData['history_coverage']>) => void
}) {
  return <div className="forecast-options space-y-3">
    <p className="text-sm text-muted">只添加确认已完整记录所有收支的时间段。该区间内没有账单的月份将按零消费参与预测。</p>
    {value.map((item, i) => <div key={i} className="grid gap-3 sm:grid-cols-3">
      <div className="field"><label>完整记录开始日期</label><input aria-label={`覆盖开始 ${i + 1}`} type="date" max={item.end_date} value={item.start_date} onChange={e => { if (e.target.value) onChange(value.map((x, j) => j === i ? { ...x, start_date: e.target.value } : x)) }}/></div>
      <div className="field"><label>完整记录结束日期</label><input aria-label={`覆盖结束 ${i + 1}`} type="date" min={item.start_date} max={today()} value={item.end_date} onChange={e => { if (e.target.value) onChange(value.map((x, j) => j === i ? { ...x, end_date: e.target.value } : x)) }}/></div>
      <Button variant="secondary" onClick={() => onChange(value.filter((_, j) => i !== j))}>移除此区间</Button>
    </div>)}
    <Button variant="secondary" onClick={() => onChange([...value, { start_date: today(), end_date: today() }])}>添加完整记录区间</Button>
  </div>
}
