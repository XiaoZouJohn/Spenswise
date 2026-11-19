import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormField, Input, State, Textarea } from '../ui'
import { DraftStatus } from './LifeWidgets'
import { lifeApi, type LifeRecord } from '../../lib/lifeApi'
import { api } from '../../lib/api'
import { today, money } from '../../lib/format'
import { usePersistentDraft } from '../../lib/usePersistentDraft'
import type { LifeLogIn } from '../../client/generated/types.gen'
import type { PageData } from '../../types'

export function LifeLogEditor({ record, transactionId, onSaved, onCancel }: {
  record?: LifeRecord; transactionId?: number; onSaved: (record: LifeRecord) => void; onCancel: () => void
}) {
  const client = useQueryClient()
  const form = usePersistentDraft<LifeLogIn>('life-log', record?.id ?? 'new', {
    event_date: record?.event_date ?? today(), title: record?.title ?? '', content: record?.content ?? '',
    visibility: 'private', ai_allowed: record?.ai_allowed ?? false,
    transaction_ids: record?.transaction_ids ?? (transactionId ? [transactionId] : []), revision: record?.revision ?? 0,
  })
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = useQuery({ queryKey: ['log-transaction-picker', search], queryFn: () => api<PageData>(`/transactions?page_size=100&merchant=${encodeURIComponent(search)}`) })
  const value = form.value
  const ids = value.transaction_ids ?? []
  async function save() {
    if (!value.content.trim()) { setError('请留下一句话再保存'); return }
    setBusy(true)
    setError('')
    try {
      const stored = await lifeApi.saveLog(value, record?.id)
      try { await form.clear({ ...stored, revision: stored.revision }) } catch { /* The saved log remains authoritative if draft cleanup fails. */ }
      await Promise.all(['life-logs', 'chronicle', 'village-state', 'market-review', 'transaction-event'].map(key => client.invalidateQueries({ queryKey: [key] })))
      onSaved(stored)
    } catch { setError('记录暂时没保存成功，草稿还在。请重新打开后核对。') }
    finally { setBusy(false) }
  }
  return <form className="life-log-editor" onSubmit={event => { event.preventDefault(); void save() }}>
    <FormField label="日期" htmlFor="life-date"><Input id="life-date" type="date" value={value.event_date} onChange={event => form.change({ ...value, event_date: event.target.value })} required/></FormField>
    <FormField label="标题（可不填）" htmlFor="life-title"><Input id="life-title" maxLength={100} value={value.title ?? ''} onChange={event => form.change({ ...value, title: event.target.value })} placeholder="给这件事起个短名字"/></FormField>
    <FormField label="留下一句话" htmlFor="life-content"><Textarea id="life-content" maxLength={5000} value={value.content} onChange={event => form.change({ ...value, content: event.target.value })} placeholder="例如：这次临时出行是为了看望家人。" required/></FormField>
    <details><summary>关联账单 · 已选 {ids.length} 笔</summary>
      <Input aria-label="搜索关联账单" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索商户，最多显示100笔"/>
      {rows.isPending ? <State kind="loading"/> : rows.isError ? <State kind="error" retry={() => rows.refetch()}/> : <div className="log-transaction-picker">{rows.data.items.map(tx => <label key={tx.id}><input type="checkbox" checked={ids.includes(tx.id)} onChange={event => form.change({ ...value, transaction_ids: event.target.checked ? [...ids, tx.id] : ids.filter(id => id !== tx.id) })}/><span>{tx.tx_date} · {tx.merchant || tx.category}</span><strong>{money(tx.amount_cents)}</strong></label>)}</div>}
      <p className="text-sm text-muted">没有想关联的账单，也可以直接保存记录。</p>
    </details>
    <label className="log-ai-permission"><input type="checkbox" checked={!!value.ai_allowed} onChange={event => form.change({ ...value, ai_allowed: event.target.checked })}/>允许 AI 在已有账本授权内使用这篇生活记录</label>
    <p className="text-sm text-muted">这篇记录仅你可见。开启后，AI 可在你允许的范围内参考它。</p>
    <DraftStatus status={form.status} retry={form.retry} reload={form.reload}/>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <footer className="life-form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>稍后再写</Button><Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存生活记录'}</Button></footer>
  </form>
}
