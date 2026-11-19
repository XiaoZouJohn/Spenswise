import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAiConnection,
  putAiConnection,
  testAiConnection,
  type DeepSeekModel,
} from '../lib/aiConnection'
import { Badge, Button, Card, SectionTitle, State } from './ui'

export function AiConnectionSettings({ onConfigured }: { onConfigured?: () => void }) {
  const cache = useQueryClient()
  const connection = useQuery({ queryKey: ['ai-connection'], queryFn: getAiConnection })
  const [model, setModel] = useState<DeepSeekModel>('deepseek-flash')
  const [apiKey, setApiKey] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (connection.data) setModel(connection.data.model)
  }, [connection.data])

  const save = useMutation({
    mutationFn: putAiConnection,
    onSuccess: stored => {
      cache.setQueryData(['ai-connection'], stored)
      void cache.invalidateQueries({ queryKey: ['ai-status'] })
      setApiKey('')
      setConfirmClear(false)
      if (stored.configured) onConfigured?.()
    },
  })
  const test = useMutation({ mutationFn: testAiConnection })
  const hasUnsavedInput = apiKey.trim().length > 0 || model !== connection.data?.model

  return <Card id="ai-connection">
    <SectionTitle title="DeepSeek 连接" action={connection.data && <Badge tone={connection.data.configured ? 'success' : 'warning'}>{connection.data.configured ? '已配置' : '未配置'}</Badge>}/>
    {connection.isLoading ? <State kind="loading"/> : connection.isError ? <State kind="error" retry={() => connection.refetch()}/> : connection.data && <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="field">
          <label htmlFor="deepseek-model">模型</label>
          <select id="deepseek-model" value={model} onChange={event => { setModel(event.target.value as DeepSeekModel); test.reset() }}>
            <option value="deepseek-flash">DeepSeek Flash</option>
            <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="deepseek-api-key">API Key</label>
          <input
            id="deepseek-api-key"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={event => { setApiKey(event.target.value); test.reset() }}
            placeholder={connection.data.configured ? '留空则保留已保存的密钥' : '输入 DeepSeek API Key'}
          />
        </div>
      </div>
      <p className="mb-0 text-xs text-muted">服务地址：{connection.data.endpoint}。已保存的密钥不会在页面显示。</p>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
        <Button
          onClick={() => save.mutate({ model, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) })}
          disabled={save.isPending || !hasUnsavedInput}
        >保存连接</Button>
        <Button
          variant="secondary"
          onClick={() => test.mutate()}
          disabled={!connection.data.configured || hasUnsavedInput || save.isPending || test.isPending}
        >{test.isPending ? '正在测试…' : '测试连接'}</Button>
        {connection.data.configured && !confirmClear && <Button variant="ghost" onClick={() => setConfirmClear(true)}>移除密钥</Button>}
      </div>
      {confirmClear && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span>移除网页保存的密钥；若服务端环境另有密钥，连接仍可用。</span>
        <Button variant="danger" disabled={save.isPending} onClick={() => save.mutate({ model, clear_key: true })}>确认移除</Button>
        <Button variant="ghost" onClick={() => setConfirmClear(false)}>取消</Button>
      </div>}
      {hasUnsavedInput && connection.data.configured && <p className="mb-0 mt-3 text-sm text-muted">请先保存修改，再测试连接。</p>}
      {save.isSuccess && !hasUnsavedInput && <p role="status" className="mb-0 mt-3 text-sm text-success">连接设置已保存。</p>}
      {save.isError && <p role="alert" className="mb-0 mt-3 text-sm text-danger">保存失败：{save.error.message}</p>}
      {test.isSuccess && <p role="status" className={`mb-0 mt-3 text-sm ${test.data.ok ? 'text-success' : 'text-danger'}`}>{test.data.message}</p>}
      {test.isError && <p role="alert" className="mb-0 mt-3 text-sm text-danger">连接测试失败：{test.error.message}</p>}
    </>}
  </Card>
}
