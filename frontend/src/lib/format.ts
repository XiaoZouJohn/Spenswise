export const money = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(cents / 100)
export const day = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`))
export const fullDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`))
export const dateTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(value))
export const transactionTypeLabel = (value: string) => ({ expense: '支出', income: '收入', transfer: '转账', refund: '退款' })[value as 'expense' | 'income' | 'transfer' | 'refund'] ?? value
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
export const nextMonthRange = () => {
  const [year, month] = today().split('-').map(Number)
  const iso = (value: Date) => value.toISOString().slice(0, 10)
  return {
    start: iso(new Date(Date.UTC(year, month, 1))),
    end: iso(new Date(Date.UTC(year, month + 1, 0))),
  }
}
