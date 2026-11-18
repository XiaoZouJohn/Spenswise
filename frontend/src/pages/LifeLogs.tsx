import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, DetailDialog, State } from '../components/ui'
import { LifeLogEditor } from '../components/village/LifeLogEditor'
import { CharacterHint } from '../components/village/LifeWidgets'
import { lifeApi } from '../lib/lifeApi'
import { today } from '../lib/format'
import { useVillage } from '../components/village/VillageContext'
import { journeyKey } from '../lib/journeyApi'

export function LifeLogs() {
  const [params, setParams] = useSearchParams()
  const client = useQueryClient()
  const village = useVillage()
  const month = params.get('month') || village?.month || today().slice(0, 7)
  const logId = params.get('log')
  const creating = params.get('new') === '1'
  const transactionId = Number(params.get('transaction')) || undefined
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const records = useQuery({ queryKey: ['life-logs', month], queryFn: () => lifeApi.logs(month) })
  const selected = useQuery({ queryKey: ['life-log', logId], queryFn: () => lifeApi.log(logId!), enabled: !!logId })
  function close() { const next = new URLSearchParams(params); ['log', 'new', 'transaction'].forEach(key => next.delete(key)); setParams(next) }
  async function remove(id: string, revision: number) {
    if (!window.confirm('删除这篇生活记录？历史引用将显示来源已删除。')) return
    setDeleting(id)
    try { await lifeApi.deleteLog(id, revision); await Promise.all(['life-logs', 'chronicle', 'market-review'].map(key => client.invalidateQueries({ queryKey: [key] }))); await client.invalidateQueries({ queryKey: journeyKey }) }
    catch { setError('删除失败或记录已更新，请重新读取') }
    finally { setDeleting(null) }
  }
  return <div className="page life-logs-page"><header className="workspace-title"><div><p>议事厅 / 生活记录</p><h1>值得记住的小事</h1></div><Button onClick={() => setParams({ month, new: '1' })}>留下一句话</Button></header>
    <label className="life-month">记录月份<input type="month" value={month} onChange={event => { if (event.target.value) setParams({ month: event.target.value }) }}/></label>
    <CharacterHint text="不必为每一笔消费写说明。只记下你愿意回顾的事。"/>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {records.isPending ? <State kind="loading"/> : records.isError ? <State kind="error" retry={() => records.refetch()}/> : !records.data.length ? <State kind="empty" message="这个月还没有生活记录。也可以先去账房核对流水。"/> : <div className="life-log-timeline">{records.data.map(record => <article key={record.id}><time>{record.event_date}</time><div><h2>{record.title || record.content.slice(0, 30)}</h2><p className="life-log-content">{record.content}</p><div className="source-links">{record.transaction_ids?.map(id => <Link key={id} className="source-tag" to={`/ledger?ids=${id}&detail=${id}`}>关联账单 #{id} ↗</Link>)}</div><footer><Badge>{record.ai_allowed ? '允许AI使用' : '个人记录'}</Badge><Button variant="ghost" onClick={() => setParams({ month, log: record.id })}>编辑</Button><Button variant="ghost" disabled={!!deleting} onClick={() => remove(record.id, record.revision ?? 0)}>删除</Button><Button variant="ghost" onClick={() => village?.ask({ label: '生活记录', month: record.event_date.slice(0, 7) }, `请分析我明确允许AI使用的生活记录，月份为${record.event_date.slice(0, 7)}。当前记录ID为${record.id}，先调用生活记录工具核对许可及内容，不要猜测背景。`)}>询问助手</Button></footer></div></article>)}</div>}
    <DetailDialog open={creating || !!logId} onOpenChange={open => { if (!open) close() }} title={creating ? '留下一句话' : '编辑生活记录'}>
      {creating ? <LifeLogEditor key="new" transactionId={transactionId} onSaved={() => { close(); void records.refetch(); void client.invalidateQueries({ queryKey: journeyKey }) }} onCancel={close}/> : selected.isPending ? <State kind="loading"/> : selected.isError ? <State kind="error" retry={() => selected.refetch()}/> : selected.data && <LifeLogEditor key={`${selected.data.id}-${selected.data.revision}`} record={selected.data} onSaved={record => { client.setQueryData(['life-log', record.id], record); close(); void client.invalidateQueries({ queryKey: journeyKey }) }} onCancel={close}/>}
    </DetailDialog>
  </div>
}
