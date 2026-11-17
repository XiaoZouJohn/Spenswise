import { useState, type ReactNode } from 'react'
import { Badge, Card, State } from './ui'
import { money, fullDate, transactionTypeLabel } from '../lib/format'

export function Money({ cents, tone }: { cents: number; tone?: 'normal' | 'positive' | 'negative' }) { return <span className={tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : ''}>{money(cents)}</span> }
export function DateLabel({ value }: { value: string }) { return <time dateTime={value}>{fullDate(value)}</time> }
export function MetricCard({ label, cents, detail, tone }: { label: string; cents: number; detail?: ReactNode; tone?: 'normal' | 'positive' | 'negative' }) { return <Card><div className="text-sm text-muted">{label}</div><div className="mt-3 text-2xl font-semibold tracking-tight"><Money cents={cents} tone={tone}/></div>{detail && <div className="mt-2 text-xs text-muted">{detail}</div>}</Card> }
export function AmountInput({ label, value, onChange }: { label: string; value: number; onChange: (cents: number) => void }) {
  // Keep the user's text while editing; formatting on each keystroke moves the caret.
  // Pair it with cents so external resets (e.g. after adding a bill) still take effect.
  const [draft, setDraft] = useState<{ text: string; cents: number } | null>(null)
  return <div className="field"><label>{label}</label><div className="relative">
    <span className="pointer-events-none absolute left-3 top-2.5 text-muted" aria-hidden="true">¥</span>
    <input className="amount-input w-full" aria-label={label} type="number" inputMode="decimal" min="0" step="0.01"
      value={draft?.cents === value ? draft.text : (value / 100).toFixed(2)}
      onFocus={() => { if (value === 0) setDraft({ text: '', cents: 0 }) }}
      onChange={event => {
        const text = event.target.value
        const cents = Math.round(Number(text || 0) * 100)
        if (!Number.isSafeInteger(cents)) return
        setDraft({ text, cents })
        onChange(cents)
      }}
      onBlur={() => setDraft(null)}/>
  </div></div>
}
export function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (s: string) => void; onTo: (s: string) => void }) { return <div className="flex gap-3"><div className="field"><label>开始日期</label><input type="date" value={from} onChange={e => onFrom(e.target.value)}/></div><div className="field"><label>结束日期</label><input type="date" value={to} onChange={e => onTo(e.target.value)}/></div></div> }
export function CategoryPicker({ value, onChange, categories }: { value: string; onChange: (s: string) => void; categories: string[] }) { return <select className="h-10 rounded-control border border-line bg-white px-3" value={value} onChange={e => onChange(e.target.value)}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select> }
export function TransactionDetail({ item }: { item: { tx_date: string; merchant: string; description: string; category: string; amount_cents: number; tx_type: string; source: string; confidence?: number; classification_reason?: string } }) { return <div className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-muted">日期</span><DateLabel value={item.tx_date}/></div><div className="flex justify-between"><span className="text-muted">金额</span><Money cents={item.amount_cents}/></div><div className="flex justify-between"><span className="text-muted">类型</span><Badge>{transactionTypeLabel(item.tx_type)}</Badge></div><div className="flex justify-between"><span className="text-muted">商户</span><span>{item.merchant}</span></div><div className="flex justify-between"><span className="text-muted">分类</span><span>{item.category}</span></div>{item.classification_reason&&<><div className="flex justify-between gap-4"><span className="shrink-0 text-muted">分类置信度</span><Badge tone={(item.confidence??0)>=80?'success':(item.confidence??0)>=55?'warning':'neutral'}>{item.confidence??0}%</Badge></div><div><span className="text-muted">分类依据</span><p className="mb-0 mt-1 leading-6">{item.classification_reason}</p></div></>}<div className="flex justify-between"><span className="text-muted">来源</span><span>{item.source}</span></div><p>{item.description}</p></div> }
export function ScenarioComparison({ before, after, minimum, reserve, minimumLabel = "最低余额" }: { before: number; after: number; minimum: number; reserve: number; minimumLabel?: string }) { return <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><MetricCard label="购买前期末" cents={before}/><MetricCard label="购买后期末" cents={after}/><MetricCard label={minimumLabel} cents={minimum} tone={minimum < reserve ? 'negative' : 'positive'}/><MetricCard label="目标保留" cents={reserve}/></div> }
export { State }
