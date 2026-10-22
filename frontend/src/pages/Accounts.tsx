import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AmountInput, Money } from '../components/business'
import { Badge, Button, Card, CenterDialog, FormField, Input, SectionTitle, SelectInput, State } from '../components/ui'
import { familyErrorMessage, familyApi, type AccountSnapshot } from '../lib/familyApi'
import { fullDate, today } from '../lib/format'

type AssetDraft = Omit<AccountSnapshot, 'id' | 'account_key' | 'archived'>
const empty: AssetDraft = { name: '', kind: 'asset', ownership: 'individual', shared_account_key: null, balance_cents: 0, as_of: today(), include_in_family: false, is_cash_account: false }

export function AccountsPage() {
  const client = useQueryClient()
  const assets = useQuery({ queryKey: ['assets'], queryFn: familyApi.assets })
  const coverage = useQuery({ queryKey: ['assets', 'coverage'], queryFn: familyApi.assetCoverage })
  const policy = useQuery({ queryKey: ['assets', 'coverage-policy'], queryFn: familyApi.assetCoveragePolicy })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<AssetDraft>({ ...empty })
  const [policyDraft, setPolicyDraft] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = Array.from(new Map((assets.data ?? []).slice().sort((a, b) => a.as_of === b.as_of ? a.id - b.id : a.as_of.localeCompare(b.as_of)).map(item => [item.account_key, item])).values()).filter(item => !item.archived)
  const validDays = policyDraft ?? policy.data?.valid_days ?? 30

  function open(item?: AccountSnapshot) {
    setEditing(item?.account_key ?? 'new')
    setDraft(item ? { name: item.name, kind: item.kind, ownership: item.ownership ?? 'individual', shared_account_key: item.shared_account_key ?? null, balance_cents: item.balance_cents, as_of: today(), include_in_family: item.include_in_family, is_cash_account: item.is_cash_account } : { ...empty, as_of: today() })
    setError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    if (draft.ownership === 'joint' && draft.include_in_family && !draft.shared_account_key?.trim()) { setError('纳入家庭的共有账户需要填写共同约定的账户代号'); return }
    setBusy(true)
    try {
      await familyApi.saveAsset({ ...draft, shared_account_key: draft.ownership === 'joint' ? draft.shared_account_key?.trim() || null : null, ...(editing && editing !== 'new' ? { account_key: editing } : {}) })
      await client.invalidateQueries({ queryKey: ['assets'] })
      await client.invalidateQueries({ queryKey: ['family'] })
      setEditing(null); setMessage('账户快照已保存')
    } catch (issue) { setError(familyErrorMessage(issue, '保存失败')) }
    finally { setBusy(false) }
  }

  async function setCoverage(confirmed: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      await familyApi.updateAssetCoverage(confirmed)
      await client.invalidateQueries({ queryKey: ['assets'] })
      await client.invalidateQueries({ queryKey: ['family'] })
      setMessage(confirmed ? '已确认纳入范围' : '已取消完整覆盖确认')
    } catch (issue) { setError(familyErrorMessage(issue, '设置失败')) }
    finally { setBusy(false) }
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365) { setError('估值有效期须为 1～365 天'); return }
    setBusy(true)
    try {
      const updated = await familyApi.updateAssetCoveragePolicy(validDays)
      setPolicyDraft(updated.valid_days)
      await client.invalidateQueries({ queryKey: ['assets'] })
      await client.invalidateQueries({ queryKey: ['family'] })
      setMessage('估值有效期已更新，请重新确认覆盖范围')
    } catch (issue) { setError(familyErrorMessage(issue, '保存有效期失败')) }
    finally { setBusy(false) }
  }

  async function archive(item: AccountSnapshot) {
    setBusy(true); setError(''); setMessage('')
    try {
      await familyApi.archiveAsset(item.account_key)
      await client.invalidateQueries({ queryKey: ['assets'] })
      await client.invalidateQueries({ queryKey: ['family'] })
      setMessage('账户已归档')
    } catch (issue) { setError(familyErrorMessage(issue, '归档失败')) }
    finally { setBusy(false) }
  }

  return <div className="page space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="m-0 text-3xl font-semibold">账户与资产</h1><p className="mt-2 text-sm text-muted">记录账户、资产与负债的日期快照。家庭财富仅统计主动纳入且覆盖完整的数据。</p></div><Button onClick={() => open()}>添加账户或资产</Button></header>
    <Card><SectionTitle title="家庭财富覆盖范围"/><p className="mt-0 max-w-3xl text-sm leading-6 text-muted">每项资产或负债可单独选择是否纳入家庭。确认覆盖表示你已录入愿意纳入的全部项目。共有账户由成员填写相同的约定代号，且记录一致时自动去重；记录冲突会暂停显示完整家庭净资产。代号不要使用银行卡号等敏感信息。过期快照或未确认覆盖时，不展示完整家庭净资产。</p>
      {policy.isLoading ? <State kind="loading"/> : policy.isError ? <State kind="error" retry={() => policy.refetch()}/> : <form onSubmit={savePolicy} className="mb-5 flex flex-wrap items-end gap-3"><div className="w-56"><FormField label="估值有效期（天）" htmlFor="asset-valid-days" hint="每位成员可单独设置 1～365 天"><Input id="asset-valid-days" type="number" min={1} max={365} step={1} value={validDays} onChange={event => setPolicyDraft(Number(event.target.value))} required/></FormField></div><Button type="submit" variant="secondary" disabled={busy || validDays === policy.data?.valid_days}>保存有效期</Button><span className="text-sm text-muted">修改后需重新确认覆盖范围</span></form>}
      {coverage.isLoading ? <State kind="loading"/> : coverage.isError ? <State kind="error" retry={() => coverage.refetch()}/> : <div className="flex flex-wrap items-center justify-end gap-3 sm:justify-start"><Badge tone={coverage.data?.confirmed ? 'success' : 'warning'}>{coverage.data?.confirmed ? '已确认覆盖' : '尚未确认覆盖'}</Badge><Button variant="secondary" disabled={busy} onClick={() => setCoverage(!coverage.data?.confirmed)}>{coverage.data?.confirmed ? '取消确认' : '确认纳入范围已完整'}</Button></div>}</Card>
    {assets.isLoading ? <State kind="loading"/> : assets.isError ? <State kind="error" retry={() => assets.refetch()}/> : latest.length ? <div className="grid gap-5 lg:grid-cols-2">{latest.map(item => <Card key={item.account_key}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><h2 className="m-0 break-words text-lg font-semibold">{item.name}</h2><Badge>{item.kind === 'asset' ? '资产' : '负债'}</Badge><Badge tone={item.ownership === 'joint' ? 'warning' : 'neutral'}>{item.ownership === 'joint' ? '共有' : '个人'}</Badge></div><p className="m-0 text-sm text-muted">估值 {fullDate(item.as_of)} · {item.is_cash_account ? '现金账户' : '非现金项目'}</p>{item.ownership === 'joint' && <p className="mb-0 mt-1 break-all text-sm text-muted">共同代号：{item.shared_account_key || '尚未填写'}</p>}</div><div className="text-xl font-semibold"><Money cents={item.balance_cents}/></div></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><Badge tone={item.include_in_family ? 'success' : 'neutral'}>{item.include_in_family ? '纳入家庭财富' : '仅个人记录'}</Badge><div className="flex gap-2"><Button variant="secondary" onClick={() => open(item)}>更新快照</Button><Button variant="ghost" disabled={busy} onClick={() => archive(item)}>归档</Button></div></div></Card>)}</div> : <Card><State kind="empty" message="尚未记录资产或负债"/><div className="text-center"><Button onClick={() => open()}>添加第一项</Button></div></Card>}
    {message && <p role="status" className="text-sm text-success">{message}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <CenterDialog open={editing !== null} onOpenChange={value => { if (!value) setEditing(null) }} title={editing === 'new' ? '添加账户或资产' : '更新账户快照'}><form onSubmit={save} className="space-y-4"><FormField label="名称" htmlFor="asset-name"><Input id="asset-name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={100}/></FormField><div className="grid gap-4 sm:grid-cols-2"><FormField label="类型" htmlFor="asset-kind"><div id="asset-kind"><SelectInput label="资产或负债" value={draft.kind} onValueChange={value => setDraft({ ...draft, kind: value as 'asset' | 'liability', is_cash_account: value === 'liability' ? false : draft.is_cash_account })} options={[{ value: 'asset', label: '资产' }, { value: 'liability', label: '负债' }]}/></div></FormField><FormField label="归属" htmlFor="asset-ownership"><div id="asset-ownership"><SelectInput label="个人或共有" value={draft.ownership ?? 'individual'} onValueChange={value => setDraft({ ...draft, ownership: value as 'individual' | 'joint', shared_account_key: value === 'individual' ? null : draft.shared_account_key })} options={[{ value: 'individual', label: '个人' }, { value: 'joint', label: '共有' }]}/></div></FormField></div>{draft.ownership === 'joint' && <FormField label="共同约定的账户代号" htmlFor="asset-shared-key" hint="同一共有账户的成员填写相同代号；不要填写银行卡号等敏感信息。"><Input id="asset-shared-key" value={draft.shared_account_key ?? ''} onChange={event => setDraft({ ...draft, shared_account_key: event.target.value })} minLength={3} maxLength={64} required={!!draft.include_in_family}/></FormField>}<AmountInput label="当前金额" value={draft.balance_cents} onChange={value => setDraft({ ...draft, balance_cents: value })}/><FormField label="估值日期" htmlFor="asset-date"><Input id="asset-date" type="date" max={today()} value={draft.as_of} onChange={event => setDraft({ ...draft, as_of: event.target.value })} required/></FormField><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={draft.include_in_family} onChange={event => setDraft({ ...draft, include_in_family: event.target.checked })} className="accent-accent"/>纳入家庭财富统计</label>{draft.ownership === 'joint' && draft.include_in_family && <p className="m-0 text-sm text-warning">如其他成员也录入此共有账户，请使用相同代号，并保持金额、类型、现金属性与估值日期一致。</p>}{draft.kind === 'asset' && <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={draft.is_cash_account} onChange={event => setDraft({ ...draft, is_cash_account: event.target.checked })} className="accent-accent"/>这是可用于现金流起点的现金账户</label>}<p className="m-0 text-sm text-muted">更新会新增一条日期快照，历史记录不会被覆盖。</p>{error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>取消</Button><Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存快照'}</Button></div></form></CenterDialog>
  </div>
}
