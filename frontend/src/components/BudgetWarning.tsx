import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { BudgetStatusData } from '../types'
import { Money } from './business'
import { Button, CenterDialog } from './ui'

export function BudgetAlertSummary({ data }: { data: BudgetStatusData }) {
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 rounded-control bg-canvas p-4 text-sm sm:grid-cols-3">
      <div><div className="text-muted">本月收入</div><div className="mt-1 font-semibold"><Money cents={data.income_cents}/></div></div>
      <div><div className="text-muted">本月净消费</div><div className="mt-1 font-semibold"><Money cents={data.spent_cents}/></div></div>
      <div><div className="text-muted">总预算上限</div><div className="mt-1 font-semibold"><Money cents={data.total_limit_cents}/></div></div>
    </div>
    {data.alerts.length === 0 ? <div className="rounded-control border border-line p-4 text-sm text-success">按当前预算，本月尚未超额。</div> : data.alerts.map(alert => {
      const ratio = alert.limit_cents > 0 ? Math.round(alert.spent_cents / alert.limit_cents * 100) : null
      return <div key={`${alert.scope}:${alert.category || ''}`} className="rounded-control border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{alert.scope === 'total' ? '总消费预算' : `${alert.category}预算`}</span>
          <span className="rounded-control bg-red-50 px-2 py-1 font-semibold text-danger">超出 <Money cents={alert.over_cents}/></span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-danger" style={{ width: `${Math.min(100, ratio ?? 100)}%` }}/></div>
        <div className="mt-2 flex justify-between gap-3 text-xs text-muted"><span>已消费 <Money cents={alert.spent_cents}/> / 限额 <Money cents={alert.limit_cents}/></span><span>{ratio === null ? '无额度' : `${ratio}%`}</span></div>
      </div>
    })}
    <p className="m-0 text-xs text-muted">按本月已记录账单计算；退款冲减消费，收入和转账不计入消费预算。</p>
  </div>
}

export function BudgetWarning({ draft, autoOpen = true }: { draft?: BudgetStatusData | null; autoOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const status = useQuery({
    queryKey: ['budget-status'],
    queryFn: () => api<BudgetStatusData>('/budget/status'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  })
  const saved = status.data
  const data = draft ?? saved
  const signature = saved ? `spendwise-budget-alert:${saved.month}:${saved.data_version}` : ''

  useEffect(() => {
    if (autoOpen && pathname !== '/settings' && !draft && saved?.alerts.length && signature && sessionStorage.getItem(signature) !== 'dismissed') {
      setOpen(true)
    }
  }, [autoOpen, draft, pathname, saved, signature])

  useEffect(() => { if (data && data.alerts.length === 0) setOpen(false) }, [data])

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next && signature) sessionStorage.setItem(signature, 'dismissed')
  }

  if (!data?.alerts.length) return null

  return <>
    <div className="flex justify-center border-b border-line bg-white px-4 py-3" role="status">
      <Button variant="secondary" className="border-danger text-danger" onClick={() => setOpen(true)}><AlertTriangle size={17}/> {draft ? '当前填写' : '本月'} {data.alerts.length} 项预算超额 · 查看警示</Button>
    </div>
    <CenterDialog open={open} onOpenChange={changeOpen} title={`${data.month} 预算警示`}>
      <div className="mb-5 flex items-center gap-3 rounded-control bg-red-50 p-4 text-sm text-danger"><AlertTriangle size={22}/><span>{draft ? '按当前填写的预算实时计算；保存后在全站生效。' : '当前消费已超过计划，请核对本月预算。'}</span></div>
      <BudgetAlertSummary data={data}/>
    </CenterDialog>
  </>
}
