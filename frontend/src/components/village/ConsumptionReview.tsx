import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { lifeApi, type EventRecord } from '../../lib/lifeApi'
import { api } from '../../lib/api'
import { money, today } from '../../lib/format'
import type { PageData } from '../../types'
import { Button, DetailDialog, State } from '../ui'
import { CategoryIcon } from './CategoryIcon'
import { Paper, CharacterHint } from './LifeWidgets'
import { TransactionBackground } from './TransactionBackground'
import { useVillage } from './VillageContext'
import { ledgerHref } from '../../lib/village'

export function ConsumptionReview() {
  const [params, setParams] = useSearchParams()
  const village = useVillage()
  const client = useQueryClient()
  const month = village?.month ?? today().slice(0, 7)
  const selected = params.get('category') || ''
  const [event, setEvent] = useState<EventRecord | null>(null)
  const data = useQuery({ queryKey: ['market-review', month], queryFn: () => lifeApi.market(month) })
  const transactions = useQuery({ queryKey: ['transactions', 'market', month, selected], enabled: !!selected,
    queryFn: () => api<PageData>(`${ledgerHref(month, selected).replace('/ledger', '/transactions')}&page_size=100`) })
  const defer = useMutation({ mutationFn: (item: EventRecord) => lifeApi.saveEvent(item.transaction_id, { purpose: item.purpose, feeling: item.feeling, note: item.note, deferred: !item.deferred, revision: item.revision }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['market-review'] }); void client.invalidateQueries({ queryKey: ['village-state'] }) } })
  function choose(category: string) { const next = new URLSearchParams(params); if (category) next.set('category', category); else next.delete('category'); setParams(next) }
  if (data.isPending) return <State kind="loading"/>
  if (data.isError) return <State kind="error" retry={() => data.refetch()}/>
  const value = data.data
  return <div className="consumption-review">
    <CharacterHint text={`这个月花了 ${money(value.facts.expense_cents)}。来看看主要花在了哪里。`}/>
    <p className="text-sm text-muted">比较日期：{value.comparison_from} — {value.comparison_to}，与本月相同已发生天数。退款冲减支出，转账不计入。</p>
    <div className="market-stalls">{value.categories.map(row => <button key={row.category} onClick={() => choose(row.category)} className="market-stall"><CategoryIcon category={row.category}/><span><strong>{row.category}</strong><small>本月净支出</small></span><b>{money(row.amount_cents)}</b><small>{value.facts.expense_cents > 0 ? `${Math.round(row.amount_cents / value.facts.expense_cents * 100)}%` : '—'} · 上月同期 {money(row.previous_cents)} · 变化 {row.change_cents > 0 ? '+' : ''}{money(row.change_cents)}</small></button>)}</div>
    {!value.categories.length && <State kind="empty" message="本月还没有消费记录，导入后再来看看。"/>}
    <Paper title="值得回看的消费">{!value.events.length ? <p>暂时没有需要回看的事件，也可以在账单详情主动标记。</p> : value.events.map(item => <article key={item.id} className={`consumption-event ${item.deferred ? 'is-deferred' : ''}`}><div><small>{item.origin === 'rule' ? '规则提醒' : '你标记的事'} · {item.reason}</small><h3>{item.transaction?.merchant || '消费记录'} <span>{money(item.transaction?.amount_cents ?? 0)}</span></h3><p>{item.purpose || '想记住这笔消费？可以留下一句话。'}</p></div><footer><Button variant="secondary" onClick={() => setEvent(item)}>回看这件事</Button><Button variant="ghost" disabled={defer.isPending} onClick={() => defer.mutate(item)}>{item.deferred ? '放回待办' : '以后再看'}</Button></footer></article>)}{defer.isError && <p role="alert">未能更新，保留原状态，请重试。</p>}</Paper>
    <Paper title="你的生活记录">{value.logs.slice(0, 8).map(log => <Link className="life-reference" key={log.id} to={`/logs?log=${log.id}`}><time>{log.event_date}</time><span>{log.title || log.content.slice(0, 50)}</span></Link>)}<Link className="story-action" to={`/logs?new=1&month=${month}`}>值得留下的一件事 ↗</Link></Paper>
    <DetailDialog title={`${selected} · 消费回看`} open={!!selected} onOpenChange={open => { if (!open) choose('') }}>
      <Paper title="账本记录">{transactions.isPending ? <State kind="loading"/> : transactions.isError ? <State kind="error" retry={() => transactions.refetch()}/> : transactions.data.items.map(tx => <Link className="life-reference" key={tx.id} to={`/ledger?ids=${tx.id}&detail=${tx.id}`}><time>{tx.tx_date}</time><span>{tx.merchant || tx.description}</span><strong>{money(tx.amount_cents)}</strong></Link>)}<Link className="story-action" to={ledgerHref(month, selected)}>查看此类别全部流水 ↗</Link></Paper>
      <Paper title="你的记录">{value.logs.filter(log => log.transaction_ids?.some(id => transactions.data?.items.some(tx => tx.id === id))).map(log => <Link className="life-reference" to={`/logs?log=${log.id}`} key={log.id}>{log.title || log.content.slice(0, 60)}</Link>)}<p>这类消费还没有生活记录。</p></Paper>
      <Paper title="分析判断"><Button onClick={() => village?.ask({ label: `${selected}消费回看`, month, building: '集市', category: selected }, `请解释${month}的${selected}消费变化。先用账本工具核对本月与上月同天数区间，再按需读取明确允许AI使用的生活记录。分为“账本记录、你的记录、分析判断”，给出账单依据；缺少背景就留白。`)}>分析这次变化</Button><Link className="story-action" to={`/simulate?view=simulation&category=${encodeURIComponent(selected)}`}>比较下个月的一项消费 ↗</Link></Paper>
    </DetailDialog>
    <DetailDialog title="这件消费的背景" open={!!event} onOpenChange={open => { if (!open) setEvent(null) }}>{event && <><Paper title="账本记录"><p>{event.transaction?.tx_date} · {event.transaction?.merchant} · {money(event.transaction?.amount_cents ?? 0)}</p><p>{event.reason}</p></Paper><TransactionBackground key={event.transaction_id} transactionId={event.transaction_id} month={month}/></>}</DetailDialog>
  </div>
}
