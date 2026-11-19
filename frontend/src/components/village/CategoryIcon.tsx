const categoryIcons: Record<string, string> = {
  待确认: 'pending', 餐饮: 'dining', 交通: 'transport', 购物: 'shopping',
  居住: 'housing', 医疗健康: 'medical', 娱乐: 'entertainment', 旅行: 'travel',
  通讯: 'communication', 教育: 'education', 日用品: 'daily', 人情往来: 'gifts',
  收入: 'income', 退款: 'refund', 转账: 'transfer', 其他: 'other',
}

export function CategoryIcon({ category, className = '' }: { category: string; className?: string }) {
  const name = categoryIcons[category] ?? categoryIcons.其他
  return <img aria-hidden="true" alt="" className={`category-icon ${className}`} src={`/media/village/categories/${name}.png`}/>
}
