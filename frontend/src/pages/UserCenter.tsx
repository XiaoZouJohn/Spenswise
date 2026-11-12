import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, CenterDialog, Disclosure, FormField, Input, SectionTitle, State } from '../components/ui'
import { familyErrorMessage, familyApi } from '../lib/familyApi'
import { dateTime, today } from '../lib/format'
import { useSession } from '../lib/session'

export function UserCenter() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const session = useSession()
  const sessions = useQuery({ queryKey: ['security', 'sessions'], queryFn: familyApi.sessions, enabled: !!session.data })
  const [name, setName] = useState<string | null>(null)
  const [claimCode, setClaimCode] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session.isLoading) return <div className="page"><State kind="loading"/></div>
  if (!session.data) return null
  const user = session.data.user

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setStatus(''); setError(''); setBusy(true)
    try { await familyApi.updateMe((name ?? user.display_name).trim()); await client.invalidateQueries({ queryKey: ['session'] }); setStatus('资料已保存') }
    catch (issue) { setError(familyErrorMessage(issue, '保存失败')) }
    finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setStatus(''); setError('')
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return }
    if (newPassword.length < 10) { setError('新密码至少需要 10 个字符'); return }
    setBusy(true)
    try {
      await familyApi.changePassword(currentPassword, newPassword)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      await client.invalidateQueries({ queryKey: ['security', 'sessions'] })
      setStatus('密码已修改，其他设备的登录已失效')
    } catch (issue) { setError(familyErrorMessage(issue, '修改密码失败')) }
    finally { setBusy(false) }
  }

  async function revokeSession(id: string, current: boolean) {
    setBusy(true); setError(''); setStatus('')
    try {
      await familyApi.revokeSession(id)
      if (current) { client.clear(); navigate('/overview', { replace: true }); return }
      await client.invalidateQueries({ queryKey: ['security', 'sessions'] })
      setStatus('已退出所选设备')
    } catch (issue) { setError(familyErrorMessage(issue, '退出设备失败')) }
    finally { setBusy(false) }
  }

  async function exportData() {
    setBusy(true); setError(''); setStatus('')
    try {
      const data = await familyApi.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'SpendWise-个人数据-' + today() + '.json'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setStatus('个人数据已下载')
    } catch (issue) { setError(familyErrorMessage(issue, '导出失败')) }
    finally { setBusy(false) }
  }

  async function claim(event: FormEvent) {
    event.preventDefault(); setStatus(''); setError(''); setBusy(true)
    try { await familyApi.claimLegacy(claimCode.trim()); setClaimCode(''); await client.invalidateQueries(); setStatus('原有数据已归入当前账号') }
    catch (issue) { setError(familyErrorMessage(issue, '认领失败')) }
    finally { setBusy(false) }
  }

  async function logout() {
    setBusy(true); setError('')
    try { await familyApi.logout(); client.clear(); navigate('/overview', { replace: true }) }
    catch (issue) { setError(familyErrorMessage(issue, '退出失败')) }
    finally { setBusy(false) }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault(); setDeleteError('')
    if (!deleteConfirmed || !deletePassword) return
    setBusy(true)
    try {
      await familyApi.deleteAccount(deletePassword)
      client.clear()
      navigate('/overview', { replace: true })
    } catch (issue) { setDeleteError(familyErrorMessage(issue, '注销失败，请确认密码及家庭关系')) }
    finally { setBusy(false) }
  }

  return <div className="page space-y-6">
    <header><h1 className="m-0 text-3xl font-semibold">用户中心</h1><p className="mt-2 text-sm text-muted">管理个人资料、账号安全、数据和家庭关系</p></header>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><Disclosure title="个人资料" description="查看邮箱并修改显示称呼"><form onSubmit={saveProfile} className="space-y-4"><FormField label="邮箱" htmlFor="profile-email"><Input id="profile-email" value={user.email} readOnly/></FormField><FormField label="称呼" htmlFor="profile-name"><Input id="profile-name" value={name ?? user.display_name} onChange={event => setName(event.target.value)} required maxLength={80}/></FormField><Button type="submit" disabled={busy}>保存资料</Button></form></Disclosure></Card>
      <Card><SectionTitle title="我的家庭"/>{session.data.family ? <><div className="text-lg font-semibold">{session.data.family.name}</div><p className="mt-2 text-sm text-muted">{session.data.family.role === 'leader' ? '组长' : '成员'} · {session.data.family.member_count} 人</p><Button variant="secondary" onClick={() => navigate('/family/members')}>成员与权限</Button></> : <><p className="mt-0 text-sm text-muted">还未加入家庭。</p><Button variant="secondary" onClick={() => navigate('/family')}>创建或加入家庭</Button></>}</Card>
      <Card><Disclosure title="修改密码" description="验证当前密码后设置新密码"><form onSubmit={changePassword} className="space-y-4"><FormField label="当前密码" htmlFor="password-current"><Input id="password-current" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required/></FormField><FormField label="新密码" htmlFor="password-new" hint="至少 10 个字符"><Input id="password-new" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={event => setNewPassword(event.target.value)} required/></FormField><FormField label="再次输入新密码" htmlFor="password-confirm"><Input id="password-confirm" type="password" autoComplete="new-password" minLength={10} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required/></FormField><Button type="submit" disabled={busy}>更新密码</Button></form></Disclosure></Card>
      <Card><Disclosure title="登录设备" description="查看并退出其他登录会话" badge={sessions.data?.length ? <Badge>{sessions.data.length} 个会话</Badge> : undefined}>{sessions.isLoading ? <State kind="loading"/> : sessions.isError ? <State kind="error" retry={() => sessions.refetch()}/> : sessions.data?.length ? <div className="divide-y divide-line">{sessions.data.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div><div className="flex items-center gap-2 text-sm font-semibold">登录会话 {item.current && <Badge tone="success">当前设备</Badge>}</div><div className="mt-1 text-sm text-muted">登录 {dateTime(item.created_at)} · 到期 {dateTime(item.expires_at)}</div></div><Button type="button" variant="secondary" disabled={busy} onClick={() => revokeSession(item.id, item.current)}>{item.current ? '退出此设备' : '退出该设备'}</Button></div>)}</div> : <State kind="empty" message="没有可管理的登录设备"/>}</Disclosure></Card>
    </div>
    <Card><Disclosure title="个人数据" description="导出账单、预算、AI 对话与资产快照"><p className="mt-0 text-sm leading-6 text-muted">下载自己的账单、设置、预算、导入记录、AI 对话与资产快照，文件仅保存在本机。</p><Button type="button" variant="secondary" disabled={busy} onClick={exportData}>导出个人数据 JSON</Button></Disclosure></Card>
    {session.data.claim_available && <Card><SectionTitle title="认领原有数据"/><p className="mt-0 max-w-2xl text-sm leading-6 text-muted">原有版本的数据需要通过本机生成的一次性认领码归入账号。请先在项目后端运行认领码命令，再在此提交；已归属的数据不能再次认领。</p><form onSubmit={claim} className="flex max-w-xl flex-col gap-3 sm:flex-row"><Input aria-label="原有数据认领码" value={claimCode} onChange={event => setClaimCode(event.target.value)} placeholder="输入一次性认领码" required autoComplete="off"/><Button type="submit" disabled={busy} className="shrink-0">认领数据</Button></form></Card>}
    <Card><SectionTitle title="危险操作"/><p className="mt-0 max-w-3xl text-sm leading-6 text-muted">注销账号会永久删除你的个人数据，无法恢复。请先导出需要保留的数据；如仍在家庭组中，需先退出，组长需先转让身份或解散家庭。正在执行的导入需先完成；排队中的导入会自动取消。</p><Button type="button" variant="danger" disabled={busy} onClick={() => { setDeleteOpen(true); setDeletePassword(''); setDeleteConfirmed(false); setDeleteError('') }}>注销账号</Button></Card>
    <div className="flex flex-wrap items-center gap-4"><Button variant="secondary" onClick={logout} disabled={busy}>退出登录</Button>{status && <span className="text-sm text-success" role="status">{status}</span>}{error && <span className="text-sm text-danger" role="alert">{error}</span>}</div>
    <CenterDialog open={deleteOpen} onOpenChange={open => { if (!open && busy) return; setDeleteOpen(open); if (!open) { setDeletePassword(''); setDeleteConfirmed(false); setDeleteError('') } }} title="注销账号"><form onSubmit={deleteAccount} className="space-y-4"><p className="m-0 text-sm leading-7">此操作会永久删除你的账单、设置、AI 对话与资产记录，无法恢复。请先退出家庭组，正在执行的导入需先完成；排队中的导入会取消。</p><FormField label="输入当前密码" htmlFor="delete-password"><Input id="delete-password" type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} required/></FormField><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)} className="mt-1 accent-danger"/><span>我确认注销后无法恢复个人数据</span></label>{deleteError && <p role="alert" className="m-0 text-sm text-danger">{deleteError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>取消</Button><Button type="submit" variant="danger" disabled={busy || !deleteConfirmed || !deletePassword}>{busy ? '注销中…' : '确认永久注销'}</Button></div></form></CenterDialog>
  </div>
}
