import { Trash2 } from 'lucide-react'
import type { Transaction } from '../types'
import { money, transactionTypeLabel } from '../lib/format'
import { State } from './ui'
import { CategoryIcon } from './village/CategoryIcon'

type DayGroup = {
  date: string
  items: Transaction[]
  expense: number
  income: number
}

function groupByDay(items: Transaction[]) {
  const groups = new Map<string, DayGroup>()
  for (const item of items) {
    const group = groups.get(item.tx_date) ?? { date: item.tx_date, items: [], expense: 0, income: 0 }
    group.items.push(item)
    if (item.tx_type === 'expense') group.expense += item.amount_cents
    if (item.tx_type === 'income' || item.tx_type === 'refund') group.income += item.amount_cents
    groups.set(item.tx_date, group)
  }
  return [...groups.values()]
}

function dateParts(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return {
    day: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date),
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
  }
}

function amountClass(item: Transaction) {
  if (item.tx_type === 'expense') return 'is-expense'
  if (item.tx_type === 'income' || item.tx_type === 'refund') return 'is-income'
  return 'is-transfer'
}

function signedMoney(item: Transaction) {
  const sign = item.tx_type === 'expense' ? '−' : item.tx_type === 'income' || item.tx_type === 'refund' ? '+' : ''
  return `${sign}${money(item.amount_cents)}`
}

export function TransactionDayList({
  items,
  selected = [],
  onSelect,
  onDetail,
  onDelete,
  groupByDate = true,
}: {
  items: Transaction[]
  selected?: number[]
  onSelect?: (ids: number[]) => void
  onDetail: (item: Transaction) => void
  onDelete?: (item: Transaction) => void
  groupByDate?: boolean
}) {
  const groups = groupByDate ? groupByDay(items) : items.map(item => ({ date: item.tx_date, items: [item], expense: item.tx_type === 'expense' ? item.amount_cents : 0, income: item.tx_type === 'income' || item.tx_type === 'refund' ? item.amount_cents : 0 }))
  if (!groups.length) return <State kind="empty"/>

  const toggle = (item: Transaction) => {
    if (!onSelect) return
    onSelect(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id])
  }

  return <div className="ledger-day-list">
    {groups.map(group => {
      const label = dateParts(group.date)
      return <section className="ledger-day-card" key={groupByDate ? group.date : group.items[0].id} aria-labelledby={`ledger-day-${group.items[0].id}`}>
        <header className="ledger-day-head">
          <h3 id={`ledger-day-${group.items[0].id}`}>{label.day}<span>（{label.weekday}）</span></h3>
          {groupByDate && <p><span>支 {money(group.expense)}</span><i/> <span>收 {money(group.income)}</span></p>}
        </header>
        <div className="ledger-day-entries">
          {group.items.map(item => <article className={`ledger-day-entry ${selected.includes(item.id) ? 'is-selected' : ''}`} key={item.id}>
            {onSelect && <input type="checkbox" aria-label={`选择账单 ${item.id}`} checked={selected.includes(item.id)} onChange={() => toggle(item)}/>} 
            <CategoryIcon category={item.category} className={`ledger-entry-mark ${amountClass(item)}`}/>
            <button className="ledger-entry-main" onClick={() => onDetail(item)}>
              <strong>{item.merchant || item.description || '未命名账单'}</strong>
              <small>{transactionTypeLabel(item.tx_type)} · {item.category}{item.description && item.description !== item.merchant ? ` · ${item.description}` : ''}</small>
            </button>
            <button className={`ledger-entry-amount ${amountClass(item)}`} onClick={() => onDetail(item)} aria-label={`查看账单，金额 ${money(item.amount_cents)}`}>{signedMoney(item)}</button>
            {onDelete && <button className="ledger-entry-delete" onClick={() => onDelete(item)} aria-label={`删除${item.merchant || '这条账单'}`}><Trash2 size={16}/></button>}
          </article>)}
        </div>
      </section>
    })}
  </div>
}
