import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CenterDialog, Button, FormField, Input } from '../components/ui'
import { FamilyPendingAccess } from '../components/family'
import { familyErrorMessage, familyApi, type InvitationPreview } from '../lib/familyApi'
import { today } from '../lib/format'

export function FamilyWelcome() {
  const client = useQueryClient()
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [shareFrom, setShareFrom] = useState(today())
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      if (dialog === 'create') await familyApi.createFamily(name.trim())
      else { if (!invitation || !consent) return; await familyApi.acceptInvite(code.trim(), { share_from: shareFrom, share_transactions: consent }) }
      await client.invalidateQueries({ queryKey: ['session'] })
      await client.invalidateQueries({ queryKey: ['family'] })
      setDialog(null)
    } catch (issue) { setError(familyErrorMessage(issue, '操作失败')) }
    finally { setBusy(false) }
  }
  async function previewInvite() { setBusy(true); setError(''); setInvitation(null); try { setInvitation(await familyApi.previewInvitation(code.trim())) } catch (issue) { setError(familyErrorMessage(issue, '邀请码无效')) } finally { setBusy(false) } }
  return <div className="page py-12"><FamilyPendingAccess onCreate={() => { setError(''); setDialog('create') }} onJoin={() => { setError(''); setDialog('join') }}/>
    <CenterDialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null) }} title={dialog === 'create' ? '创建家庭' : '接受家庭邀请'}>
      <form className="space-y-5" onSubmit={submit}>{dialog === 'create' ? <FormField label="家庭名称" htmlFor="family-name"><Input id="family-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required placeholder="例如：我们的家"/></FormField> : <>
        <FormField label="邀请码" htmlFor="family-code"><Input id="family-code" value={code} onChange={event => { setCode(event.target.value); setInvitation(null); setConsent(false) }} required autoComplete="off"/></FormField>
        <Button type="button" variant="secondary" disabled={busy || !code.trim()} onClick={previewInvite}>查看邀请</Button>
        {invitation && <><div className="border-l-2 border-accent bg-canvas px-3 py-2 text-sm leading-6"><strong>{invitation.family_name}</strong><br/>{invitation.inviter_name} 邀请你加入 · {invitation.expires_at.slice(0, 10)} 前有效</div>
          <FormField label="向组长共享账单的起始日期" htmlFor="share-from" hint="默认从今天开始；如需共享过去的账单，可主动提前日期。"><Input id="share-from" type="date" max={today()} value={shareFrom} onChange={event => setShareFrom(event.target.value)} required/></FormField>
          <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 accent-accent"/><span>我同意从所选日期起，让该家庭的组长只读查看我的收支明细。私人 AI 会话与密钥不会共享。</span></label></>}
      </>}{error && <p className="m-0 text-sm text-danger" role="alert">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button type="submit" disabled={busy || (dialog === 'join' && (!invitation || !consent))}>{busy ? '处理中…' : dialog === 'create' ? '创建' : '确认加入'}</Button></div></form>
    </CenterDialog>
  </div>
}
