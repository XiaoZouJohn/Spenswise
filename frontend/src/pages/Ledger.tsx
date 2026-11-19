import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ForecastPortrait } from '../components/village/FinancialPortraits'
import { AiClassificationPanel } from '../components/AiClassificationPanel'
import { AmountInput, CategoryPicker, TransactionDetail } from '../components/business'
import { TransactionTable } from '../components/TransactionTable'
import { Badge, Button, Card, CenterDialog, DetailDialog, Disclosure, SectionTitle, State } from '../components/ui'
import { ImportPanel } from './Import'
import { api, json } from '../lib/api'
import { familyApi } from '../lib/familyApi'
import { today } from '../lib/format'
import { useSession } from '../lib/session'
import { useWorkspaceDraft } from '../lib/useWorkspaceDraft'
import { lifeApi } from '../lib/lifeApi'
import { TransactionBackground } from '../components/village/TransactionBackground'
import { JourneyTipCard } from '../components/village/VillageJourney'
import { journeyKey } from '../lib/journeyApi'
import type { PageData, Transaction } from '../types'

const categories = ['待确认', '餐饮', '交通', '购物', '居住', '医疗健康', '娱乐', '旅行', '通讯', '教育', '日用品', '人情往来', '收入', '退款', '转账', '其他']

type DeleteTarget = Transaction | 'all' | null

export function Ledger() {
  const cache = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const [adding, setAdding] = useState(false)
  useEffect(() => { if (search.get('new') === '1') setAdding(true) }, [search])
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [detailSelection, setDetail] = useState<Transaction | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [category, setCategory] = useState('保留原分类')
  const [batchDate, setBatchDate] = useState('')
  const [batchAccount, setBatchAccount] = useState('')
  const [undo, setUndo] = useState<{ id: number; category: string }[]>([])
  const [merchantDraft, setMerchantDraft] = useState(search.get('merchant') || '')
  const [form, setForm] = useWorkspaceDraft('ledger-entry', {
    tx_date: today(), amount_cents: 0, merchant: '', description: '', category: '待确认', tx_type: 'expense', account_key: null as string | null,
  })

  const review = search.get('review') === '1'
  const filterCategory = search.get('category') || ''
  const txType = search.get('tx_type') || ''
  const merchant = search.get('merchant') || ''
  const dateFrom = search.get('date_from') || ''
  const dateTo = search.get('date_to') || ''
  const ids = search.get('ids') || ''
  const requestParams = new URLSearchParams({ page: String(page), page_size: '25', review: String(review) })
  if (filterCategory) requestParams.set('category', filterCategory)
  if (txType) requestParams.set('tx_type', txType)
  if (merchant) requestParams.set('merchant', merchant)
  if (dateFrom) requestParams.set('date_from', dateFrom)
  if (dateTo) requestParams.set('date_to', dateTo)
  if (ids) requestParams.set('ids', ids)
  if (search.get('account_key')) requestParams.set('account_key', search.get('account_key')!)
  const assets = useQuery({ queryKey: ['assets'], queryFn: familyApi.assets })
  const accounts = Array.from(new Map((assets.data ?? []).filter(row => !row.archived).map(row => [row.account_key, row])).values())
  const status = useQuery({ queryKey: ['village-state', 'ledger', today().slice(0, 7)], queryFn: () => lifeApi.state(today().slice(0, 7)) })
  const linkedDetail = useQuery({ queryKey: ['transactions', 'detail', search.get('detail')], enabled: !!search.get('detail'), queryFn: () => api<PageData>(`/transactions?ids=${encodeURIComponent(search.get('detail')!)}`) })
  const shownDetail = detailSelection ?? linkedDetail.data?.items[0] ?? null

  const detail = shownDetail
  const query = useQuery({
    queryKey: ['transactions', requestParams.toString()],
    queryFn: () => api<PageData>(`/transactions?${requestParams.toString()}`),
  })

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearch(next)
    setPage(1)
    setSelected([])
  }
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ['transactions'] })
    cache.invalidateQueries({ queryKey: ['overview'] })
    cache.invalidateQueries({ queryKey: ['cashflow-outlook'] })
    cache.invalidateQueries({ queryKey: ['budget-status'] })
    cache.invalidateQueries({ queryKey: ['budget-preview'] })
    cache.invalidateQueries({ queryKey: ['family'] })
    for (const key of ['chronicle', 'village-state', 'market-review']) void cache.invalidateQueries({ queryKey: [key] })
    void cache.invalidateQueries({ queryKey: journeyKey })
  }

  const add = useMutation({
    mutationFn: () => api('/transactions', json('POST', form)),
    onSuccess: () => { refresh(); setForm({ ...form, merchant: '', amount_cents: 0 }); setAdding(false) },
  })
  const batch = useMutation({
    mutationFn: () => api<{ before: { id: number; category: string }[] }>('/transactions/batch-category', json('POST', { ids: selected, category, create_rule: false })),
    onSuccess: data => { setUndo(data.before || []); setSelected([]); refresh() },
  })
  const restore = useMutation({
    mutationFn: () => api('/transactions/undo-category', json('POST', undo)),
    onSuccess: () => { setUndo([]); refresh() },
  })
  const confirmReview = useMutation({ mutationFn: () => lifeApi.batch({ ids: selected, category: category === '保留原分类' ? null : category, tx_date: batchDate || null, account_key: batchAccount && batchAccount !== 'clear' ? batchAccount : null, clear_account: batchAccount === 'clear', confirmed: true }), onSuccess: () => { setSelected([]); refresh() } })
  const remove = useMutation({
    mutationFn: (target: Exclude<DeleteTarget, null>) => target === 'all'
      ? api<{ deleted: number }>('/transactions', { method: 'DELETE' })
      : api<{ deleted: number }>(`/transactions/${target.id}`, { method: 'DELETE' }),
    onSuccess: (_result, target) => {
      if (target === 'all') setSelected([])
      else setSelected(current => current.filter(id => id !== target.id))
      setDeleteTarget(null)
      setDetail(null)
      setPage(1)
      refresh()
    },
  })
  const sharing = useMutation({
    mutationFn: ({ id, shared }: { id: number; shared: boolean }) => familyApi.shareTransaction(id, shared),
    onSuccess: result => {
      setDetail(current => current && current.id === result.id ? { ...current, family_shared: result.family_shared, family_internal: result.family_internal } : current)
      refresh()
    },
  })
  const internal = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) => familyApi.internalTransaction(id, value),
    onSuccess: result => {
      setDetail(current => current && current.id === result.id ? { ...current, family_internal: result.family_internal, family_shared: result.family_shared } : current)
      refresh()
    },
  })
  const session = useSession()
  const activeFilterCount = [review, filterCategory, txType, merchant, dateFrom, dateTo, ids].filter(Boolean).length
  return <div className="page ledger-page space-y-6">
    <header><p className="mb-1 text-sm text-muted">交易与分类</p><h1 className="m-0 text-3xl font-semibold">账本</h1></header>
    <div className="ledger-toolbar"><Button onClick={() => updateFilter('import', '1')}>导入账单</Button><Button variant="secondary" onClick={() => setAdding(true)}>记一笔</Button></div>
    <JourneyTipCard kind="ledger"/>
    {status.data && <div className="pending-strip"><button onClick={() => updateFilter('category', '待确认')}>未分类 <strong>{status.data.unclassified}</strong></button><button onClick={() => updateFilter('review', '1')}>待核对 <strong>{status.data.unreviewed}</strong></button><button onClick={() => updateFilter('import', '1')}>导入异常 <strong>{status.data.import_errors}</strong></button></div>}
    <ForecastPortrait/>
    <div className="ledger-cross-actions"><Button asChild variant="secondary"><Link to={`/simulate?category=${encodeURIComponent(filterCategory || '当前消费')}&from=${encodeURIComponent('/ledger?' + search.toString())}`}>在集市比较一项消费 →</Link></Button></div>

    <DetailDialog open={adding} onOpenChange={open => { setAdding(open); if (!open && search.get('new')) updateFilter('new', '') }} title="新增账单">
      <div className="grid gap-3 md:grid-cols-6">
        <div className="field"><label>日期</label><input type="date" value={form.tx_date} onChange={event => setForm({ ...form, tx_date: event.target.value })}/></div>
        <div className="field"><label>类型</label><select value={form.tx_type} onChange={event => setForm({ ...form, tx_type: event.target.value })}><option value="expense">支出</option><option value="income">收入</option><option value="refund">退款</option><option value="transfer">转账</option></select></div>
        <div className="field"><label>商户</label><input value={form.merchant} onChange={event => setForm({ ...form, merchant: event.target.value })}/></div>
        <AmountInput label="金额" value={form.amount_cents} onChange={value => setForm({ ...form, amount_cents: value })}/>
        <div className="field"><label>分类</label><CategoryPicker value={form.category} onChange={value => setForm({ ...form, category: value })} categories={categories}/></div>
        <div className="field"><label>所属账户</label><select value={form.account_key || ''} onChange={event => setForm({ ...form, account_key: event.target.value || null })}><option value="">未关联</option>{accounts.map(row => <option key={row.account_key} value={row.account_key}>{row.name}</option>)}</select></div>
        <div className="flex items-end"><Button onClick={() => add.mutate()} disabled={add.isPending || !form.amount_cents}>添加</Button></div>
      </div>
      {add.isError && <p className="text-sm text-danger">{add.error.message}</p>}
    </DetailDialog>

    <DetailDialog open={search.get('import') === '1'} onOpenChange={open => { if (!open) updateFilter('import', '') }} title="导入账单"><ImportPanel/></DetailDialog>

    <Card>
      <SectionTitle title="交易记录" action={<div className="flex flex-wrap gap-2">
        <Button variant={review ? 'primary' : 'secondary'} onClick={() => updateFilter('review', review ? '' : '1')}>待审核</Button>
        <Button variant="secondary" onClick={() => { setSearch({}); setMerchantDraft(''); setPage(1); setSelected([]) }}>全部账单</Button>
        <Button variant="danger" disabled={query.isLoading} onClick={() => setDeleteTarget('all')}><Trash2 size={16}/>删除全部</Button>
      </div>}/>

      <div className="mb-4">
        <Disclosure title="筛选与搜索" description="按收支类型、分类、日期和商户缩小交易范围" badge={<Badge tone={activeFilterCount ? 'warning' : 'neutral'}>{activeFilterCount ? `${activeFilterCount} 个条件` : '全部账单'}</Badge>} defaultOpen={activeFilterCount > 0}>
          <div className="rounded-panel border border-line bg-canvas p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <div className="field"><label>收支类型</label><select value={txType} onChange={event => updateFilter('tx_type', event.target.value)}><option value="">全部类型</option><option value="expense">支出</option><option value="income">收入</option><option value="refund">退款</option><option value="transfer">转账</option></select></div>
              <div className="field"><label>消费分类</label><select value={filterCategory} onChange={event => updateFilter('category', event.target.value)}><option value="">全部分类</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
              <div className="field"><label>开始日期</label><input type="date" value={dateFrom} max={dateTo || undefined} onChange={event => updateFilter('date_from', event.target.value)}/></div>
              <div className="field"><label>结束日期</label><input type="date" value={dateTo} min={dateFrom || undefined} onChange={event => updateFilter('date_to', event.target.value)}/></div>
              <form className="field xl:col-span-2" onSubmit={event => { event.preventDefault(); updateFilter('merchant', merchantDraft.trim()) }}>
                <label>搜索商户</label>
                <div className="flex gap-2"><input value={merchantDraft} placeholder="输入商户名称" onChange={event => setMerchantDraft(event.target.value)}/><Button type="submit" variant="secondary"><Search size={16}/>搜索</Button></div>
              </form>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
              <span>{activeFilterCount ? `已启用 ${activeFilterCount} 个筛选条件` : '当前显示全部账单'}</span>
              {activeFilterCount > 0 && <Button variant="ghost" onClick={() => { setSearch({}); setMerchantDraft(''); setPage(1); setSelected([]) }}>重置筛选</Button>}
            </div>
          </div>
        </Disclosure>
      </div>

      <AiClassificationPanel items={query.data?.items || []} selectedIds={selected} onSaved={before => { setUndo(before); setSelected([]); refresh() }}/>
      {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-control bg-canvas p-3 text-sm">已选 {selected.length} 笔 <CategoryPicker value={category} onChange={setCategory} categories={['保留原分类', ...categories]}/><Button onClick={() => batch.mutate()} disabled={batch.isPending || category === '保留原分类'}>批量修改分类</Button></div>}
      {selected.length > 0 && <div className="batch-review-controls"><label>修正日期<input aria-label="批量修正日期" type="date" value={batchDate} onChange={event => setBatchDate(event.target.value)}/></label><label>关联账户<select value={batchAccount} onChange={event => setBatchAccount(event.target.value)}><option value="">保留原账户</option><option value="clear">解除账户关联</option>{accounts.map(row => <option key={row.account_key} value={row.account_key}>{row.name}</option>)}</select></label><Button disabled={confirmReview.isPending} onClick={() => confirmReview.mutate()}>修正并确认所选记录</Button>{confirmReview.isSuccess && <span role="status">已确认</span>}{confirmReview.isError && <p role="alert">操作失败，记录可能冲突或已变更，请刷新后重试。</p>}</div>}
      {undo.length > 0 && <div className="mb-4 flex items-center gap-3 text-sm text-success">分类已更新 <Button variant="secondary" onClick={() => restore.mutate()}>撤销</Button></div>}
      {query.isLoading ? <State kind="loading"/> : query.isError ? <State kind="error" message={query.error.message} retry={() => query.refetch()}/> : <>
        <TransactionTable items={query.data?.items || []} selected={selected} onSelect={setSelected} onDetail={setDetail} onDelete={item => setDeleteTarget(item)}/>
        <div className="mt-4 flex items-center justify-between text-sm text-muted"><span>共 {query.data?.total || 0} 笔</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button><Button variant="secondary" disabled={page * 25 >= (query.data?.total || 0)} onClick={() => setPage(page + 1)}>下一页</Button></div></div>
      </>}
    </Card>

    <DetailDialog open={!!shownDetail} onOpenChange={open => { if (!open) { setDetail(null); updateFilter('detail', '') } }} title="账单详情">
      {shownDetail && <TransactionBackground key={shownDetail.id} transactionId={shownDetail.id} month={shownDetail.tx_date.slice(0, 7)}/>}
      {detail && <>
        <TransactionDetail item={detail}/>
        <div className="mt-5"><Button variant="danger" onClick={() => setDeleteTarget(detail)}><Trash2 size={16}/>删除这条账单</Button></div>
        {session.data?.family && <div className="mt-6 border-t border-line pt-5"><h3 className="mb-3 mt-0 text-base font-semibold">家庭归属</h3><div className="flex flex-wrap gap-2">{(detail.tx_type === 'expense' || detail.tx_type === 'refund') && <Button variant={(detail as Transaction & { family_shared?: boolean }).family_shared ? 'primary' : 'secondary'} disabled={sharing.isPending || internal.isPending} onClick={() => sharing.mutate({ id: detail.id, shared: !(detail as Transaction & { family_shared?: boolean }).family_shared })}>{(detail as Transaction & { family_shared?: boolean }).family_shared ? '已标为家庭共担 · 点击取消' : '标为家庭共担'}</Button>}<Button variant={(detail as Transaction & { family_internal?: boolean }).family_internal ? 'primary' : 'secondary'} disabled={sharing.isPending || internal.isPending} onClick={() => internal.mutate({ id: detail.id, value: !(detail as Transaction & { family_internal?: boolean }).family_internal })}>{(detail as Transaction & { family_internal?: boolean }).family_internal ? '已标为家庭内部往来 · 点击取消' : '标为家庭内部往来'}</Button></div><p className="mb-0 mt-3 text-sm leading-6 text-muted">共担支出纳入家庭预算；内部往来保留在个人账本，但不计入家庭收支。两种标记互斥。</p>{(sharing.isError || internal.isError) && <p role="alert" className="text-sm text-danger">{sharing.error?.message || internal.error?.message}</p>}</div>}
      </>}
    </DetailDialog>

    <CenterDialog open={deleteTarget !== null} onOpenChange={open => { if (!open && !remove.isPending) setDeleteTarget(null) }} title={deleteTarget === 'all' ? '确认删除全部账单' : '确认删除这条账单'}>
      <p className="mt-0 leading-7">{deleteTarget === 'all' ? `将永久删除当前账号中的全部账单。此操作无法撤销，预算、预测和统计也会随之更新。` : deleteTarget ? `将永久删除“${deleteTarget.merchant || deleteTarget.description || `账单 #${deleteTarget.id}`}”。此操作无法撤销。` : ''}</p>
      <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" disabled={!deleteTarget || remove.isPending} onClick={() => { if (deleteTarget) remove.mutate(deleteTarget) }}>{remove.isPending ? '正在删除…' : deleteTarget === 'all' ? '确认删除全部' : '确认删除'}</Button></div>
      {remove.isError && <p role="alert" className="mb-0 mt-3 text-sm text-danger">删除失败：{remove.error.message}</p>}
    </CenterDialog>
  </div>
}
