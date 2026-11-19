import { useState } from 'react'
import type { CategoryBudgetIn } from '../client/generated/types.gen'
import { AmountInput } from './business'
import { Button } from './ui'

const commonCategories = ['餐饮', '交通', '购物', '居住', '医疗健康', '娱乐', '旅行', '通讯', '其他', '待确认']

export function BudgetLimitsEditor({
  items,
  observedCategories,
  onChange,
}: {
  items: CategoryBudgetIn[]
  observedCategories: string[]
  onChange: (next: CategoryBudgetIn[]) => void
}) {
  const [customCategory, setCustomCategory] = useState('')
  const categories = Array.from(new Set([...commonCategories, ...observedCategories, ...items.map(x => x.category)]))

  function setLimit(category: string, limit_cents: number) {
    onChange([...items.filter(item => item.category !== category), { category, limit_cents }])
  }

  return <div className="space-y-3">
    <p className="m-0 text-sm text-muted">分类上限会沿用到每个月。没有单独设置的类别，仍受总预算限制。</p>
    <div className="grid gap-3 md:grid-cols-2">
      {categories.map(category => {
        const current = items.find(item => item.category === category)
        return <div key={category} className="flex items-end justify-between gap-3 rounded-control border border-line p-3">
          <span className="min-w-16 pb-2 text-sm font-semibold">{category}</span>
          {current ? <div className="flex flex-1 items-end justify-end gap-2">
            <div className="max-w-40 flex-1"><AmountInput label="每月上限" value={current.limit_cents} onChange={value => setLimit(category, value)}/></div>
            <Button variant="ghost" onClick={() => onChange(items.filter(item => item.category !== category))}>移除</Button>
          </div> : <Button variant="secondary" onClick={() => setLimit(category, 10000)}>设置上限</Button>}
        </div>
      })}
    </div>
    <div className="flex max-w-sm gap-2">
      <input className="h-10 min-w-0 flex-1 rounded-control border border-line bg-white px-3" aria-label="自定义分类名称" placeholder="其他分类名称" maxLength={80} value={customCategory} onChange={event => setCustomCategory(event.target.value)}/>
      <Button variant="secondary" disabled={!customCategory.trim() || categories.includes(customCategory.trim())} onClick={() => { setLimit(customCategory.trim(), 10000); setCustomCategory('') }}>添加分类</Button>
    </div>
  </div>
}
