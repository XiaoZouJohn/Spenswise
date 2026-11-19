import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, FormField, Input } from '../components/ui'
import { familyErrorMessage, familyApi } from '../lib/familyApi'

export function AuthPage() {
  const client = useQueryClient()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(''); setBusy(true)
    try {
      const session = mode === 'login' ? await familyApi.login({ email, password }) : await familyApi.register({ email, password, display_name: name.trim() })
      client.setQueryData(['session'], session)
      await client.invalidateQueries({ queryKey: ['session'] })
    } catch (issue) { setError(familyErrorMessage(issue, '暂时无法登录')) }
    finally { setBusy(false) }
  }
  async function enterGuest() {
    setError(''); setBusy(true)
    try {
      const session = await familyApi.guest()
      client.setQueryData(['session'], session)
      await client.invalidateQueries({ queryKey: ['session'] })
    } catch (issue) { setError(familyErrorMessage(issue, '暂时无法进入游客模式')) }
    finally { setBusy(false) }
  }
  return <main className="family-auth min-h-screen px-4 py-12"><div className="mx-auto max-w-md"><div className="mb-8 text-center"><div className="text-3xl font-bold tracking-tight text-accent">SpendWise</div><p className="mt-3 text-base text-muted">登录后继续管理个人账本与家庭计划</p></div>
    <Card className="p-7"><div className="mb-7 flex border-b border-line" role="tablist" aria-label="登录方式"><button type="button" role="tab" aria-selected={mode === 'login'} className={'family-auth-tab ' + (mode === 'login' ? 'is-active' : '')} onClick={() => { setMode('login'); setError('') }}>登录</button><button type="button" role="tab" aria-selected={mode === 'register'} className={'family-auth-tab ' + (mode === 'register' ? 'is-active' : '')} onClick={() => { setMode('register'); setError('') }}>注册</button></div>
      <form onSubmit={submit} className="space-y-5">{mode === 'register' && <FormField label="称呼" htmlFor="auth-name"><Input id="auth-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required maxLength={80}/></FormField>}
        <FormField label="邮箱" htmlFor="auth-email"><Input id="auth-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required/></FormField>
        <FormField label="密码" htmlFor="auth-password" hint={mode === 'register' ? '至少 10 位' : undefined}><Input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === 'register' ? 10 : undefined}/></FormField>
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}</Button>
      </form>
      <div className="mt-5 border-t border-line pt-5"><Button type="button" variant="secondary" disabled={busy} onClick={enterGuest} className="w-full">以游客身份体验</Button><p className="mt-2 text-center text-sm text-muted">使用独立的演示账本，AI 体验次数较少。</p></div>
    </Card></div></main>
}
