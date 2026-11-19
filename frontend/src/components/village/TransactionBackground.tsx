import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Input, Textarea, State } from '../ui'
import { lifeApi } from '../../lib/lifeApi'
import { useVillage } from './VillageContext'

export function TransactionBackground({ transactionId, month }: { transactionId: number; month: string }) {
  const client = useQueryClient()
  const village = useVillage()
  const query = useQuery({ queryKey: ['transaction-event', transactionId], queryFn: () => lifeApi.event(transactionId) })
  const stories = useQuery({ queryKey: ['transaction-story', transactionId], queryFn: () => lifeApi.transactionStory(transactionId) })
  const [draft, setDraft] = useState<{ purpose: string; feeling: string; note: string; deferred: boolean }>()
  const value = draft ?? { purpose: query.data?.purpose ?? '', feeling: query.data?.feeling ?? '', note: query.data?.note ?? '', deferred: query.data?.deferred ?? false }
  const save = useMutation({ mutationFn: () => lifeApi.saveEvent(transactionId, { ...value, revision: query.data?.revision ?? 0 }), onSuccess: stored => {
    client.setQueryData(['transaction-event', transactionId], stored)
    setDraft(undefined)
    for (const key of ['market-review', 'chronicle', 'village-state']) void client.invalidateQueries({ queryKey: [key] })
  } })
  return <section className="transaction-background"><details><summary>这件事的背景 <small>可跳过</small></summary>
    {query.isPending ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : <div className="background-note">
      <label>消费目的<Input value={value.purpose} maxLength={200} placeholder="例如：看望家人的临时出行" onChange={event => setDraft({ ...value, purpose: event.target.value })}/></label>
      <label>当时的感受<Input value={value.feeling} maxLength={80} placeholder="值得、普通、需要再想想……" onChange={event => setDraft({ ...value, feeling: event.target.value })}/></label>
      <label>简短说明<Textarea value={value.note} maxLength={2000} onChange={event => setDraft({ ...value, note: event.target.value })}/></label>
      <label><input type="checkbox" checked={value.deferred} onChange={event => setDraft({ ...value, deferred: event.target.checked })}/>稍后回看，不放入当前待办</label>
      <Button disabled={save.isPending} onClick={() => save.mutate()}>保存背景并标记事件</Button>
      {save.isSuccess && <p role="status">背景已保存</p>}{save.isError && <p role="alert" className="text-danger">暂时没保存成功，请重新打开后核对</p>}
    </div>}
    </details>
    <Link className="story-action" to={`/logs?new=1&transaction=${transactionId}&month=${month}`}>留下一句话，关联这笔账单 ↗</Link>
    {query.data?.logs?.map(log => <Link className="source-tag" key={log.id} to={`/logs?log=${log.id}`}>{log.title || log.content.slice(0, 30)} ↗</Link>)}
    {stories.data?.map(story => <Link className="story-action" key={`${story.edition_id}-${story.chapter}`} to={`/overview?month=${story.month}&chapter=${story.chapter}&edition=${story.edition_id}`}>查看相关故事 · {story.title} ↗</Link>)}
    <Button variant="ghost" onClick={() => village?.ask({ label: `账单事件 #${transactionId}`, month }, `请先核对本人账单ID ${transactionId}。按“账本记录、你的记录、分析判断”解释这笔消费；生活背景只读取我明确允许AI使用的生活记录。`)}>分析这件事</Button>
  </section>
}
