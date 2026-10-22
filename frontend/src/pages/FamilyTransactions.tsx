import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { TransactionTable } from '../components/TransactionTable'
import { TransactionDetail } from '../components/business'
import { Button, Card, DetailDialog, FormField, Input, SelectInput, State } from '../components/ui'
import { familyApi } from '../lib/familyApi'
import { useSession } from '../lib/session'
import type { Transaction } from '../types'

export function FamilyTransactionsPage() {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const [detail, setDetail] = useState<Transaction | null>(null)
  const page = Math.max(1, Number(params.get('page') || 1))
  const filter = { user_id: params.get('user_id') ? Number(params.get('user_id')) : undefined, category: params.get('category') || undefined, date_from: params.get('date_from') || undefined, date_to: params.get('date_to') || undefined, ids: params.get('ids') || undefined, common_only: params.get('common_only') === 'true', page, page_size: 25 }
  const transactions = useQuery({ queryKey: ['family', 'transactions', filter.user_id, filter.category, filter.date_from, filter.date_to, filter.ids, filter.common_only, page], queryFn: () => familyApi.transactions(filter) })
  const members = useQuery({ queryKey: ['family', 'members'], queryFn: familyApi.members, enabled: session.data?.family?.role === 'leader' })
  function update(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); setParams(next) }
  return <div className="page space-y-5"><header><h1 className="m-0 text-3xl font-semibold">{filter.common_only ? '家庭共担账单' : '家庭收支'}</h1><p className="mt-2 text-sm text-muted">按授权范围查看来源账单。成员只能查看自己的明细。</p></header>
    <Card><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{session.data?.family?.role === 'leader' && <FormField label="成员" htmlFor="family-member-filter"><div id="family-member-filter"><SelectInput label="按成员筛选" value={params.get('user_id') || 'all'} onValueChange={value => update('user_id', value === 'all' ? '' : value)} options={[{ value: 'all', label: '全部已共享成员' }, ...(members.data?.members ?? []).map(item => ({ value: String(item.user_id), label: item.display_name }))]}/></div></FormField>}
      <FormField label="分类" htmlFor="family-category-filter"><Input id="family-category-filter" value={params.get('category') || ''} onChange={event => update('category', event.target.value)} placeholder="全部分类"/></FormField>
      <FormField label="开始日期" htmlFor="family-date-from"><Input id="family-date-from" type="date" value={params.get('date_from') || ''} onChange={event => update('date_from', event.target.value)}/></FormField>
      <FormField label="结束日期" htmlFor="family-date-to"><Input id="family-date-to" type="date" value={params.get('date_to') || ''} onChange={event => update('date_to', event.target.value)}/></FormField></div>
      {filter.common_only && <div className="mt-3 flex items-center gap-3 text-sm text-muted"><span>仅显示家庭共担账单</span><Button type="button" variant="ghost" onClick={() => update('common_only', '')}>查看全部授权账单</Button></div>}
      {filter.ids && <div className="mt-3 flex items-center gap-3 text-sm text-muted"><span>正在查看现金流事件的来源账单</span><Button type="button" variant="ghost" onClick={() => update('ids', '')}>清除</Button></div>}
    </Card>
    <Card className="overflow-hidden p-0">{transactions.isLoading ? <State kind="loading"/> : transactions.isError ? <State kind="error" retry={() => transactions.refetch()}/> : <><TransactionTable items={transactions.data?.items ?? []} onDetail={setDetail}/>{transactions.data && transactions.data.total > 0 && <div className="flex items-center justify-between border-t border-line p-4 text-sm text-muted"><span>共 {transactions.data.total} 笔 · 第 {page} 页</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>上一页</Button><Button variant="secondary" disabled={page * 25 >= transactions.data.total} onClick={() => update('page', String(page + 1))}>下一页</Button></div></div>}</>}</Card>
    <DetailDialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null) }} title="来源账单">{detail && <TransactionDetail item={detail}/>}</DetailDialog>
  </div>
}
