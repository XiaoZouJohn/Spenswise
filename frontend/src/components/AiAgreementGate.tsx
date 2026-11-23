import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, json } from '../lib/api'
import { familyApi } from '../lib/familyApi'
import { Button, Card, State } from './ui'

type Agreement = { accepted: boolean; version: string }

export function AiAgreementGate({ userId, children }: { userId: number; children: ReactNode }) {
  const cache = useQueryClient()
  const [read, setRead] = useState(false)
  const agreement = useQuery({ queryKey: ['ai-agreement', userId], queryFn: () => api<Agreement>('/ai/agreement') })
  const accept = useMutation({
    mutationFn: () => api<Agreement>('/ai/agreement', json('POST', {})),
    onSuccess: value => { cache.setQueryData(['ai-agreement', userId], value); void cache.invalidateQueries({ queryKey: ['ai-status'] }); void cache.invalidateQueries({ queryKey: ['ai-ledger-consent'] }) },
  })
  const leave = useMutation({ mutationFn: familyApi.logout, onSuccess: () => { cache.clear(); window.location.assign('/') } })
  if (agreement.isLoading) return <div className="session-state"><State kind="loading"/></div>
  if (agreement.isError) return <div className="session-state"><State kind="error" message="无法读取 AI 使用协议" retry={() => agreement.refetch()}/></div>
  if (agreement.data?.accepted) return <>{children}</>
  return <main className="village-auth flex min-h-screen items-center justify-center p-5">
    <Card className="w-full max-w-2xl space-y-5 bg-surface p-7 sm:p-10">
      <p className="m-0 text-sm text-accent">富贵村 · 使用说明</p>
      <h1 className="m-0 text-3xl font-semibold">开始前，请阅读 AI 使用协议</h1>
      <div className="max-h-[45vh] space-y-4 overflow-y-auto border-y border-line py-5 text-base leading-8" tabIndex={0}>
        <p>富贵村的 AI 助手由 DeepSeek 提供。你可以用它整理账单分类、生成月度回顾、查看财务简报、讨论收支和消费计划。</p>
        <p>使用这些功能时，服务端会向 DeepSeek 发送完成当前任务需要的账目数据。聊天会按需查询相关账单；月度回顾和简报会使用对应月份的汇总。你允许 AI 使用的生活记录，也可能用于解释当月变化。</p>
        <p>AI 的回答由模型生成，请以账房里的交易记录、钱庄里的账户记录和你保存的预算为准。聊天记录会保存在你的账户中，方便继续查看。</p>
        <p>你可以在右上角的“配置 API”中保存自己的 DeepSeek 密钥。密钥仅由后端加密保存，不会显示在页面上。每项 AI 功能有每日使用次数上限，服务端也有每日 token 总额度；额度用完后，可以次日再使用。</p>
      </div>
      <label className="flex items-start gap-3"><input type="checkbox" checked={read} onChange={event => setRead(event.target.checked)}/><span>我已阅读并同意上述 AI 使用协议</span></label>
      {accept.isError && <p role="alert" className="text-danger">保存失败：{accept.error.message}</p>}
      {leave.isError && <p role="alert" className="text-danger">退出失败：{leave.error.message}</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={!read || accept.isPending} onClick={() => accept.mutate()}>同意并进入富贵村</Button><Button variant="secondary" disabled={leave.isPending} onClick={() => leave.mutate()}>不同意并退出登录</Button></div>
    </Card>
  </main>
}
