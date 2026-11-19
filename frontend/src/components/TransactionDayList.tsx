import { Trash2 } from 'lucide-react'
import type { Transaction } from '../types'
import { money, transactionTypeLabel } from '../lib/format'
import { State } from './ui'

type DayGroup = {
  date: string
  items: Transaction[]
  expense: number
  income: number
}

const categoryMarks: Record<string, string> = {
  餐饮: '餐', 交通: '行', 购物: '购', 居住: '住', 医疗健康: '医', 娱乐: '娱',
  旅行: '旅', 通讯: '讯', 教育: '学', 日用品: '用', 人情往来: '礼', 收入: '收',
  退款: '退', 转账: '转', 其他: '其', 待确认: '?',
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
}: {
  items: Transaction[]
  selected?: number[]
  onSelect?: (ids: number[]) => void
  onDetail: (item: Transaction) => void
  onDelete?: (item: Transaction) => void
}) {
  const groups = groupByDay(items)
  if (!groups.length) return <State kind="empty"/>

  const toggle = (item: Transaction) => {
    if (!onSelect) return
    onSelect(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id])
  }

  return <div className="ledger-day-list">
    {groups.map(group => {
      const label = dateParts(group.date)
      return <section className="ledger-day-card" key={group.date} aria-labelledby={`ledger-day-${group.date}`}>
        <header className="ledger-day-head">
          <h3 id={`ledger-day-${group.date}`}>{label.day}<span>（{label.weekday}）</span></h3>
          <p><span>支 {money(group.expense)}</span><i/> <span>收 {money(group.income)}</span></p>
        </header>
        <div className="ledger-day-entries">
          {group.items.map(item => <article className={`ledger-day-entry ${selected.includes(item.id) ? 'is-selected' : ''}`} key={item.id}>
            {onSelect && <input type="checkbox" aria-label={`选择账单 ${item.id}`} checked={selected.includes(item.id)} onChange={() => toggle(item)}/>} 
            <span className={`ledger-entry-mark ${amountClass(item)}`} aria-hidden="true">{(categoryMarks[item.category] ?? item.category.slice(0, 1)) || '账'}</span>
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
