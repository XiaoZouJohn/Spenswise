import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AmountInput, Money } from '../components/business'
import { Button, Card, CenterDialog, FormField, Input, SectionTitle, State } from '../components/ui'
import { familyErrorMessage, familyApi, type FamilyGoal } from '../lib/familyApi'
import { useSession } from '../lib/session'
import { fullDate } from '../lib/format'

const emptyGoal = { name: '', target_cents: 0, current_cents: 0, monthly_contribution_cents: 0, target_date: null as string | null, source_note: '' }
export function FamilyGoalsPage() {
  const client = useQueryClient()
  const session = useSession()
  const query = useQuery({ queryKey: ['family', 'goals'], queryFn: familyApi.goals })
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState({ ...emptyGoal })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  function open(goal?: FamilyGoal) { setEditing(goal?.id ?? 'new'); setDraft(goal ? { name: goal.name, target_cents: goal.target_cents, current_cents: goal.current_cents, monthly_contribution_cents: goal.monthly_contribution_cents ?? 0, target_date: goal.target_date ?? null, source_note: goal.source_note ?? '' } : { ...emptyGoal }); setError('') }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { if (editing === 'new') await familyApi.createGoal(draft); else if (typeof editing === 'number') await familyApi.updateGoal(editing, draft); await client.invalidateQueries({ queryKey: ['family'] }); setEditing(null) } catch (issue) { setError(familyErrorMessage(issue, '保存失败')) } finally { setBusy(false) } }
  const leader = session.data?.family?.role === 'leader'
  return <div className="page space-y-5"><header className="flex items-start justify-between gap-4"><div><h1 className="m-0 text-3xl font-semibold">共同目标</h1><p className="mt-2 text-sm text-muted">为目标写下金额和时间，再安排每月可投入的部分。</p></div>{leader && <Button onClick={() => open()}>添加目标</Button>}</header>
    {query.isLoading ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : query.data?.length ? <div className="grid gap-5 lg:grid-cols-2">{query.data.map(goal => { const ratio = goal.target_cents > 0 ? Math.min(100, goal.current_cents / goal.target_cents * 100) : 0; return <Card key={goal.id}><SectionTitle title={goal.name} action={leader && <Button variant="ghost" onClick={() => open(goal)}>编辑</Button>}/><div className="family-goal-track"><div style={{ width: `${ratio}%` }}/></div><div className="mt-3 flex justify-between text-sm"><span>已记录 <Money cents={goal.current_cents}/></span><span>目标 <Money cents={goal.target_cents}/></span></div><div className="mt-4 border-t border-line pt-3 text-sm text-muted"><p className="m-0">来源：{goal.source_note}</p>{(goal.monthly_contribution_cents ?? 0) > 0 && <p className="mb-0 mt-1">计划每月投入：<Money cents={goal.monthly_contribution_cents ?? 0}/></p>}{goal.target_date && <p className="mb-0 mt-1">目标日期：{fullDate(goal.target_date)}</p>}</div></Card> })}</div> : <Card><State kind="empty" message="还没有共同目标"/>{leader && <div className="text-center"><Button onClick={() => open()}>添加第一个目标</Button></div>}</Card>}
    <CenterDialog open={editing !== null} onOpenChange={value => { if (!value) setEditing(null) }} title={editing === 'new' ? '添加共同目标' : '编辑共同目标'}><form onSubmit={save} className="space-y-4"><FormField label="目标名称" htmlFor="goal-name"><Input id="goal-name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={80}/></FormField><div className="grid gap-4 sm:grid-cols-2"><AmountInput label="目标金额" value={draft.target_cents} onChange={value => setDraft({ ...draft, target_cents: value })}/><AmountInput label="已积累金额" value={draft.current_cents} onChange={value => setDraft({ ...draft, current_cents: value })}/></div><AmountInput label="计划每月投入" value={draft.monthly_contribution_cents} onChange={value => setDraft({ ...draft, monthly_contribution_cents: value })}/><p className="m-0 text-sm text-muted">只有填写每月投入，议事预览才会估算共同支出对目标达成日期的影响。</p><FormField label="目标日期" htmlFor="goal-date"><Input id="goal-date" type="date" value={draft.target_date ?? ''} onChange={event => setDraft({ ...draft, target_date: event.target.value || null })}/></FormField><FormField label="已积累金额来源" htmlFor="goal-source" hint="例如：家庭共同储蓄账户余额，或手动记录。"><Input id="goal-source" value={draft.source_note} onChange={event => setDraft({ ...draft, source_note: event.target.value })} required maxLength={160}/></FormField>{error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>取消</Button><Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存目标'}</Button></div></form></CenterDialog>
  </div>
}
