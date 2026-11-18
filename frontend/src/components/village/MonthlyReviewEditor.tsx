import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Badge, State, Textarea } from '../ui'
import { StoryAction, StoryMetrics } from './StoryParts'
import { Illustration } from './Illustration'
import { useVillage } from './VillageContext'
import { useSession } from '../../lib/session'
import { reviewApi } from '../../lib/review'
import { ledgerHref } from '../../lib/village'
import type { MonthlyReviewIn, MonthlyReviewOut } from '../../client/generated/types.gen'

export function MonthlyReviewEditor({ month }: { month: string }) {
  const client = useQueryClient()
  const session = useSession()
  const village = useVillage()
  const owner = session.data?.user.id
  const draftKey = ['review-draft', owner, month]
  const queryKey = ['monthly-review', owner, month]
  const query = useQuery({ queryKey, queryFn: () => reviewApi.read(month) })
  const [draft, setDraft] = useState<MonthlyReviewIn | undefined>(() => client.getQueryData(draftKey))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const data = query.data
  const value = draft ?? data

  function change(field: 'notes' | 'constraints' | 'differences', text: string) {
    if (!value) return
    const next = { ...value, [field]: text }
    setDraft(next)
    client.setQueryData(draftKey, next)
  }
  function accepted(stored: MonthlyReviewOut) {
    client.setQueryData(queryKey, stored)
    client.removeQueries({ queryKey: draftKey })
    setDraft(undefined)
  }
  async function persist(clear = false) {
    if (!value || !data) return
    if (clear && !window.confirm('删除本月已保存的说明与盘点快照？账单仍保留。')) return
    setBusy(true)
    setError('')
    try { accepted(await (clear ? reviewApi.clear(month, value) : reviewApi.save(month, value))) }
    catch { setError('保存失败，可能已在其他窗口更新。草稿已保留，请重新读取后合并。') }
    finally { setBusy(false) }
  }
  async function reload() {
    if (draft && !window.confirm('重新读取会丢弃当前草稿，是否继续？')) return
    const result = await query.refetch()
    if (result.data) accepted(result.data)
  }
  if (query.isPending) return <State kind="loading"/>
  if (query.isError || !data || !value) return <State kind="error" retry={() => query.refetch()}/>

  const facts = data.facts as { income_cents: number; expense_cents: number; net_flow_cents: number; transaction_count: number }
  return <div className="review-document">
    <div className="review-status"><Illustration name="hall"/><strong>{month} 月度盘点</strong><Badge tone={draft || data.ledger_changed ? 'warning' : 'success'}>{draft ? '草稿' : data.ledger_changed ? '账本已更新' : data.saved_at ? '已保存' : '尚未保存'}</Badge><span>版本 {data.revision}</span></div>
    <div className="review-columns">
      <section className="review-facts"><h2>账本事实</h2><StoryMetrics income={facts.income_cents} expense={facts.expense_cents} surplus={facts.net_flow_cents}/><p>个人账本 · 已记录 {facts.transaction_count} 笔 · 人民币</p><p>退款冲减净支出，转账不计收支。账户余额与净资产在钱庄单独核对。</p><StoryAction to={ledgerHref(month)}>核对本月流水</StoryAction><StoryAction to="/accounts">查看账户覆盖</StoryAction>
        {data.ledger_changed && <p role="status">账本与保存时的事实已有变化。请核对当前数字，再保存新的盘点版本。</p>}
        {data.saved_facts && <details><summary>保存时的事实</summary><p>收入 {String(data.saved_facts.income_cents)} 分 · 净支出 {String(data.saved_facts.expense_cents)} 分</p></details>}
      </section>
      <section className="review-notes"><h2>背景与下一步</h2>
        <label htmlFor="review-notes">本月缘由</label><Textarea id="review-notes" maxLength={3000} value={value.notes ?? ''} onChange={event => change('notes', event.target.value)}/>
        <label htmlFor="review-constraints">下一阶段约束</label><Textarea id="review-constraints" maxLength={2000} value={value.constraints ?? ''} onChange={event => change('constraints', event.target.value)}/>
        <label htmlFor="review-differences">事实差异与补充说明</label><Textarea id="review-differences" maxLength={2000} value={value.differences ?? ''} onChange={event => change('differences', event.target.value)}/>
        <p>说明中的金额作为个人陈述保存，账本事实由交易记录计算。</p>
      </section>
    </div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <footer className="review-actions"><Button disabled={busy} onClick={() => persist()}>保存盘点</Button><Button variant="secondary" disabled={!!draft || !data.saved_at || data.ledger_changed} onClick={() => village?.ask({ label: `月度盘点 · v${data.revision}`, month, building: '政务中心' }, `请结合本人账本讨论 ${month} 盘点第 ${data.revision} 版。以下是我的个人说明，请核对账本依据：\n${[value.notes, value.constraints, value.differences].filter(Boolean).join('\n').slice(0, 2600)}`)}>基于已保存盘点提问</Button><Button variant="ghost" disabled={busy} onClick={reload}>重新读取</Button><Button variant="ghost" disabled={busy || !data.saved_at} onClick={() => persist(true)}>删除盘点</Button></footer>
  </div>
}
