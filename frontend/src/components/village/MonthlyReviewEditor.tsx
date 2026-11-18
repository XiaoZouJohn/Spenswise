import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Badge, State, Textarea, Input } from '../ui'
import { StoryAction, StoryMetrics } from './StoryParts'
import { Illustration } from './Illustration'
import { DraftStatus, SourceLink } from './LifeWidgets'
import { useVillage } from './VillageContext'
import { reviewApi } from '../../lib/review'
import { lifeApi, type Source } from '../../lib/lifeApi'
import { usePersistentDraft } from '../../lib/usePersistentDraft'
import { ledgerHref } from '../../lib/village'
import type { MonthlyReviewIn, MonthlyReviewOut } from '../../client/generated/types.gen'

export function MonthlyReviewEditor({ month }: { month: string }) {
  const query = useQuery({ queryKey: ['monthly-review', month], queryFn: () => reviewApi.read(month) })
  if (query.isPending) return <State kind="loading"/>
  if (query.isError) return <State kind="error" retry={() => query.refetch()}/>
  return <ReviewDocument key={month} month={month} data={query.data}/>
}

function ReviewDocument({ month, data }: { month: string; data: MonthlyReviewOut }) {
  const client = useQueryClient()
  const village = useVillage()
  const form = usePersistentDraft<MonthlyReviewIn>('monthly-review', month, data)
  const logs = useQuery({ queryKey: ['life-logs', month], queryFn: () => lifeApi.logs(month) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const value = form.value
  const selected = value.life_log_ids ?? []
  const changed = JSON.stringify([value.notes, value.constraints, value.differences, selected]) !== JSON.stringify([data.notes, data.constraints, data.differences, data.life_log_ids ?? []])
  const change = (field: 'notes' | 'constraints' | 'differences', text: string) => form.change({ ...value, [field]: text })
  async function persist(clear = false) {
    if (clear && !window.confirm('删除本月已保存的回顾？账单和生活记录仍然保留。')) return
    setBusy(true); setError('')
    try {
      const stored = await (clear ? reviewApi.clear(month, value) : reviewApi.save(month, value))
      client.setQueryData(['monthly-review', month], stored)
      await form.clear(stored)
      for (const key of ['chronicle', 'village-state']) void client.invalidateQueries({ queryKey: [key] })
    } catch { setError('保存失败，可能已在其他窗口更新。草稿已保留，请重新读取后合并。') }
    finally { setBusy(false) }
  }
  async function reload() {
    if (!window.confirm('读取最新回顾与草稿？请先复制本窗口需要保留的内容。')) return
    const stored = await reviewApi.read(month)
    client.setQueryData(['monthly-review', month], stored)
    await form.clear(stored)
  }
  const facts = data.facts as { income_cents: number; expense_cents: number; net_flow_cents: number; transaction_count: number }
  return <div className="review-document">
    <div className="review-status"><Illustration name="hall"/><strong>{month} 月度回顾</strong><Badge tone={changed || data.ledger_changed ? 'warning' : 'success'}>{changed ? '草稿' : data.ledger_changed ? '账本已更新' : data.saved_at ? '已保存' : '尚未保存'}</Badge><span>版本 {data.revision}{data.saved_at && ` · ${new Date(data.saved_at).toLocaleString('zh-CN')}`}</span></div>
    <div className="review-columns">
      <section className="review-facts"><h2>账本事实</h2><StoryMetrics income={facts.income_cents} expense={facts.expense_cents} surplus={facts.net_flow_cents}/><p>个人账本 · 已记录 {facts.transaction_count} 笔 · 人民币</p><p>退款冲减净支出，转账不计收支。账户余额与净资产在钱庄分别核对。</p><StoryAction to={ledgerHref(month)}>核对本月流水</StoryAction><StoryAction to="/accounts">查看账户覆盖</StoryAction>
        {data.ledger_changed && <p role="status">账本与保存时的事实已有变化。请核对当前数字后保存新版本。</p>}
        {data.saved_facts && <details><summary>保存时的事实</summary><p>收入 {String(data.saved_facts.income_cents)} 分 · 净支出 {String(data.saved_facts.expense_cents)} 分</p></details>}
      </section>
      <section className="review-notes"><h2>你的回顾</h2>
        <label htmlFor="review-notes">这个月发生了什么特别的事？</label><Textarea id="review-notes" maxLength={3000} placeholder="一次出行、家人的需要，或者一个想留住的瞬间。没有也可以留白。" value={value.notes ?? ''} onChange={event => change('notes', event.target.value)}/>
        <label htmlFor="review-constraints">下个月最想做好哪件事？</label><Input id="review-constraints" maxLength={2000} placeholder="只写一件最在意的事，例如为一次旅行留出预算。" value={value.constraints ?? ''} onChange={event => change('constraints', event.target.value)}/>
        <label htmlFor="review-differences">还有什么需要记住？</label><Textarea id="review-differences" maxLength={2000} placeholder="一次性支出、待报销的账，或暂时不能减少的花费。" value={value.differences ?? ''} onChange={event => change('differences', event.target.value)}/>
        <details className="review-log-picker"><summary>关联生活记录 · 已选 {selected.length} 篇</summary>{logs.isPending ? <State kind="loading"/> : logs.isError ? <State kind="error" retry={() => logs.refetch()}/> : logs.data.map(log => <label key={log.id}><input type="checkbox" checked={selected.includes(log.id)} onChange={event => form.change({ ...value, life_log_ids: event.target.checked ? [...selected, log.id] : selected.filter(id => id !== log.id) })}/><span>{log.event_date} · {log.title || log.content.slice(0, 50)}<small>关联 {log.transaction_ids?.length ?? 0} 笔账单</small></span></label>)}<Link className="story-action" to={`/logs?new=1&month=${month}`}>补充一篇生活记录 ↗</Link></details>
        <div className="source-links">{data.life_logs?.map((ref, index) => <SourceLink key={index} source={ref as Source}/>)}</div>
        <p>只保存生活记录的引用，不复制正文。你的说明与账本事实分别保留。</p>
      </section>
    </div>
    <DraftStatus status={form.status} retry={form.retry} reload={reload}/>{error && <p role="alert" className="text-danger">{error}</p>}
    <footer className="review-actions"><Button disabled={busy} onClick={() => persist()}>{busy ? '保存中…' : '保存本月回顾'}</Button><Link className="story-action" to={`/overview?month=${month}&chapter=next`}>查看本月 Story ↗</Link><Button variant="secondary" disabled={changed || !data.saved_at || data.ledger_changed} onClick={() => village?.ask({ label: `月度回顾 · v${data.revision}`, month, building: '议事厅' }, `请结合本人账本讨论${month}月度回顾第${data.revision}版。以下是我主动提供的说明，请区分账本事实与个人陈述：\n${[value.notes, value.constraints, value.differences].filter(Boolean).join('\n').slice(0, 2600)}`)}>讨论已保存回顾</Button><Button variant="ghost" disabled={busy} onClick={reload}>重新读取</Button><Button variant="ghost" disabled={busy || !data.saved_at} onClick={() => persist(true)}>删除回顾</Button></footer>
  </div>
}
