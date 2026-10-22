import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, CenterDialog, FormField, Input, SectionTitle, State } from '../components/ui'
import { familyErrorMessage, familyApi, type Member } from '../lib/familyApi'
import { useSession } from '../lib/session'
import { today } from '../lib/format'

type ConfirmAction = { kind: 'remove' | 'transfer' | 'leave' | 'dissolve'; member?: Member }
export function FamilyMembersPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const session = useSession()
  const members = useQuery({ queryKey: ['family', 'members'], queryFn: familyApi.members })
  const sharing = useQuery({ queryKey: ['family', 'sharing'], queryFn: familyApi.sharing })
  const [shareFrom, setShareFrom] = useState<string | null>(null)
  const [shareTransactions, setShareTransactions] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (sharing.data && shareFrom === null && shareTransactions === null) { setShareFrom(sharing.data.share_from); setShareTransactions(sharing.data.share_transactions) } }, [sharing.data, shareFrom, shareTransactions])
  const leader = session.data?.family?.role === 'leader'
  async function perform(action: () => Promise<unknown>, success: string, clearFamily = false) { setBusy(true); setError(''); setMessage(''); try { await action(); await client.invalidateQueries({ queryKey: ['family'] }); await client.invalidateQueries({ queryKey: ['session'] }); setMessage(success); if (clearFamily) navigate('/family') } catch (issue) { setError(familyErrorMessage(issue, '操作失败')) } finally { setBusy(false) } }
  async function createInvite(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { setInvite(await familyApi.invite(email.trim() || undefined)); setEmail('') } catch (issue) { setError(familyErrorMessage(issue, '邀请失败')) } finally { setBusy(false) } }
  async function saveSharing(event: FormEvent) { event.preventDefault(); await perform(() => familyApi.updateSharing({ share_from: shareFrom || today(), share_transactions: shareTransactions ?? false }), '共享范围已更新') }
  async function doConfirm() { if (!confirm) return; const action = confirm; setConfirm(null); if (action.kind === 'remove' && action.member) await perform(() => familyApi.removeMember(action.member!.user_id), '成员已移除'); if (action.kind === 'transfer' && action.member) await perform(() => familyApi.transferLeader(action.member!.user_id), '组长已转让'); if (action.kind === 'leave') await perform(familyApi.leaveFamily, '已退出家庭', true); if (action.kind === 'dissolve') await perform(familyApi.dissolveFamily, '家庭已解散', true) }
  return <div className="page space-y-5"><header><h1 className="m-0 text-3xl font-semibold">成员与权限</h1><p className="mt-2 text-sm text-muted">成员决定自己的共享范围；组长只能只读查看已授权收支。</p></header>
    <Card><SectionTitle title="成员"/>{members.isLoading ? <State kind="loading"/> : members.isError ? <State kind="error" retry={() => members.refetch()}/> : members.data?.members.length ? <div className="divide-y divide-line">{members.data.members.map(item => <div key={item.user_id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><div className="flex items-center gap-2"><strong>{item.display_name}</strong><Badge tone={item.role === 'leader' ? 'success' : 'neutral'}>{item.role === 'leader' ? '组长' : '成员'}</Badge></div><p className="mb-0 mt-1 text-sm text-muted">{item.email} · 加入 {item.joined_at.slice(0, 10)}</p><p className="mb-0 mt-1 text-sm text-muted">{item.share_transactions ? `共享 ${item.share_from} 起的账单` : '未共享账单'}</p></div>{leader && item.user_id !== session.data?.user.id && <div className="flex gap-2"><Button variant="secondary" onClick={() => setConfirm({ kind: 'transfer', member: item })}>转让组长</Button><Button variant="ghost" onClick={() => setConfirm({ kind: 'remove', member: item })}>移除</Button></div>}</div>)}</div> : <State kind="empty" message="暂无家庭成员"/>}</Card>
    <div className="grid gap-5 lg:grid-cols-2"><Card><SectionTitle title="我的数据共享"/>{sharing.isLoading ? <State kind="loading"/> : sharing.isError ? <State kind="error" retry={() => sharing.refetch()}/> : <form onSubmit={saveSharing} className="space-y-4"><FormField label="共享起始日期" htmlFor="member-share-from" hint="提前日期会将更多历史账单开放给组长。"><Input id="member-share-from" type="date" max={today()} value={shareFrom ?? sharing.data?.share_from ?? today()} onChange={event => setShareFrom(event.target.value)} required/></FormField><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-accent" checked={shareTransactions ?? sharing.data?.share_transactions ?? false} onChange={event => setShareTransactions(event.target.checked)}/><span>允许组长只读查看起始日期之后的个人收支</span></label><Button type="submit" disabled={busy}>保存共享范围</Button></form>}</Card>
      {leader && <Card><SectionTitle title="邀请成员"/><form onSubmit={createInvite} className="space-y-4"><FormField label="受邀邮箱（可选）" htmlFor="member-invite-email"><Input id="member-invite-email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="填写后限制该邮箱使用"/></FormField><Button type="submit" disabled={busy}>生成邀请码</Button></form>{invite && <div className="mt-5 border-l-2 border-accent bg-canvas p-4"><div className="text-sm text-muted">邀请码 · {invite.expires_at.slice(0, 10)} 前有效</div><div className="mt-1 break-all text-xl font-semibold tracking-wide">{invite.code}</div><p className="mb-0 mt-2 text-sm text-muted">请通过你信任的方式交给成员；成员在加入时自行选择共享起点。</p></div>}</Card>}
    </div>
    <Card><SectionTitle title="家庭关系"/><p className="mt-0 text-sm leading-6 text-muted">退出或移除后，组长不再能读取该成员的私人账单；每个人的个人账本仍归本人。</p><div className="flex flex-wrap gap-3">{leader ? <Button variant="danger" onClick={() => setConfirm({ kind: 'dissolve' })}>解散家庭</Button> : <Button variant="danger" onClick={() => setConfirm({ kind: 'leave' })}>退出家庭</Button>}</div></Card>
    {message && <p className="text-sm text-success" role="status">{message}</p>}{error && <p className="text-sm text-danger" role="alert">{error}</p>}
    <CenterDialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null) }} title={confirm?.kind === 'remove' ? '移除成员' : confirm?.kind === 'transfer' ? '转让组长' : confirm?.kind === 'leave' ? '退出家庭' : '解散家庭'}><p className="mt-0 leading-7">{confirm?.kind === 'remove' ? `确认移除 ${confirm.member?.display_name}？移除后将无法继续查看其私账。` : confirm?.kind === 'transfer' ? `确认将组长转让给 ${confirm.member?.display_name}？` : confirm?.kind === 'leave' ? '确认退出家庭？你的个人账本会保留。' : '确认解散家庭？共享关系将结束，每人的个人账本会保留。'}</p><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirm(null)}>取消</Button><Button variant="danger" disabled={busy} onClick={doConfirm}>确认</Button></div></CenterDialog>
  </div>
}
