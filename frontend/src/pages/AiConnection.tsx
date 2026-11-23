import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, PlugZap, Trash2 } from 'lucide-react'
import { api, json } from '../lib/api'
import { Button, Card, CenterDialog, FormField, Input, State } from '../components/ui'
import type { AiConnection, DeepSeekModel } from '../lib/aiConnection'

type TestResult = { ok: boolean; message: string; response: string }

export function AiConnectionPage() {
  const cache = useQueryClient()
  const connection = useQuery({ queryKey: ['ai-connection'], queryFn: () => api<AiConnection>('/ai/connection') })
  const [key, setKey] = useState('')
  const [model, setModel] = useState<DeepSeekModel>('deepseek-flash')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { if (connection.data) setModel(connection.data.model) }, [connection.data])

  const refresh = (value: AiConnection) => {
    cache.setQueryData(['ai-connection'], value)
    for (const queryKey of ['ai-status', 'agent-status', 'story', 'cashflow-outlook']) {
      void cache.invalidateQueries({ queryKey: [queryKey] })
    }
  }
  const save = useMutation({
    mutationFn: () => api<AiConnection>('/ai/connection', json('PUT', { api_key: key, model })),
    onSuccess: value => { setKey(''); refresh(value); test.reset() },
  })
  const test = useMutation({ mutationFn: () => api<TestResult>('/ai/test', json('POST', {})) })
  const remove = useMutation({
    mutationFn: () => api<AiConnection>('/ai/connection', { method: 'DELETE' }),
    onSuccess: value => { setConfirmDelete(false); setKey(''); refresh(value); test.reset() },
  })

  return <div className="page space-y-6">
    <header><p className="mb-1 text-sm text-muted">设置 / AI 服务</p><h1 className="m-0 text-3xl font-semibold">配置 API</h1><p className="mt-2 text-muted">连接 DeepSeek，让 AI 助手和智能分类使用你的密钥。</p></header>
    {connection.isLoading ? <State kind="loading"/> : connection.isError ? <State kind="error" message="无法读取连接配置" retry={() => connection.refetch()}/> : <Card className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3"><PlugZap size={22} className="text-accent"/><div><h2 className="m-0 text-lg font-semibold">DeepSeek 连接</h2><p className="m-0 text-sm text-muted">{connection.data?.configured ? '已保存密钥' : '尚未配置密钥'}</p></div></div>
      <FormField label="API 地址" htmlFor="ai-endpoint" hint="服务地址由系统固定，密钥只保存在本机后端。"><Input id="ai-endpoint" value={connection.data?.endpoint || 'https://api.deepseek.com'} readOnly/></FormField>
      <FormField label="模型" htmlFor="ai-model"><select id="ai-model" className="h-10 w-full rounded-control border border-line bg-white px-3 text-sm text-ink" value={model} onChange={event => setModel(event.target.value as DeepSeekModel)}><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></FormField>
      <FormField label="API Key" htmlFor="ai-key" hint={connection.data?.configured ? '已经保存密钥。需要更换时输入新密钥并再次保存；旧密钥不会显示。' : '输入你的 DeepSeek API Key。'}><Input id="ai-key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder="输入 DeepSeek API Key"/></FormField>
      <div className="flex flex-wrap gap-3"><Button disabled={!key.trim() || save.isPending} onClick={() => save.mutate()}><KeyRound size={16}/>保存密钥</Button><Button variant="secondary" disabled={!connection.data?.configured || test.isPending} onClick={() => test.mutate()}><PlugZap size={16}/>测试连接</Button><Button variant="ghost" className="text-danger" disabled={!connection.data?.configured || remove.isPending} onClick={() => setConfirmDelete(true)}><Trash2 size={16}/>删除密钥</Button></div>
      {save.isSuccess && <p role="status" className="m-0 text-accent">密钥已保存。可以点击“测试连接”验证。</p>}
      {save.isError && <p role="alert" className="m-0 text-danger">保存失败：{save.error.message}</p>}
      {test.isSuccess && <p role="status" className="m-0 text-accent">{test.data.message}{test.data.response ? ` · ${test.data.response}` : ''}</p>}
      {test.isError && <p role="alert" className="m-0 text-danger">连接测试失败：{test.error.message}</p>}
      {remove.isError && <p role="alert" className="m-0 text-danger">删除失败：{remove.error.message}</p>}
    </Card>}
    <CenterDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="删除 DeepSeek 密钥？"><p className="text-muted">删除后，这个账号的 AI 功能将无法调用 DeepSeek，直到重新保存密钥。</p><div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button><Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>确认删除</Button></div></CenterDialog>
  </div>
}
