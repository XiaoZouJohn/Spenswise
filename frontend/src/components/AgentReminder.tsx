import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Sparkles, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { agentApi, readOpening, writeOpening, type AgentBrief } from '../lib/agent'
import { useSession } from '../lib/session'
import { Badge, Button, Card, SectionTitle, State } from './ui'

const reasons: Record<string, string> = {
  consent_required: 'AI 分析未开启，当前根据本地账本规则提示。',
  not_configured: '尚未配置可用的 DeepSeek 连接，当前使用本地规则。',
  model_unavailable: 'AI 暂时不可用，已保留本地提醒，可稍后重试。',
  ready: '当前为本地分析，可点“更新分析”获取 AI 建议。',
}

export function AgentReminder({ ownerId, quiet = false }: { ownerId: number; quiet?: boolean }) {
  const client = useQueryClient()
  const [report, setReport] = useState<AgentBrief | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<(manual?: boolean) => void>(() => {})
  useEffect(() => { client.setQueryData(['agent-report', ownerId], report) }, [client, ownerId, report])

  useEffect(() => {
    let alive = true
    let running = false
    let queued = false
    let queuedManual = false
    let epoch = 0
    let automaticPopup = true
    let current: AgentBrief | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const storageKey = `spendwise-agent-opening:${ownerId}`
    const opening = readOpening(storageKey)

    function schedule(delay: number) {
      clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; void check() }, delay)
    }

    async function check(manual = false) {
      if (running) { queued = true; queuedManual ||= manual; return }
      running = true
      const ticket = epoch
      try {
        const status = await agentApi.status()
        if (!alive || ticket !== epoch) return
        setError('')
        if (!current || current.fingerprint !== status.fingerprint) {
          current = status
          setReport(status)
        }
        if (opening.month !== status.month) {
          opening.month = status.month
          opening.risks = {}
        }
        if (!status.preferences.automatic_enabled && !manual) {
          if (automaticPopup) setOpen(false)
          opening.opened = true
          writeOpening(storageKey, opening)
          return
        }
        if (status.pending_import && !manual) { schedule(3000); return }
        const increased = Object.entries(status.risks).some(([key, level]) => level > (opening.risks[key] || 0))
        if (!manual && opening.opened && !increased) return
        const remaining = 30000 - (Date.now() - opening.lastPopup)
        if (!manual && opening.opened && remaining > 0) { schedule(remaining); return }
        opening.opened = true
        opening.lastPopup = Date.now()
        for (const [key, level] of Object.entries(status.risks)) opening.risks[key] = Math.max(level, opening.risks[key] || 0)
        writeOpening(storageKey, opening)
        automaticPopup = !manual
        if (manual || !quiet) setOpen(true)
        if (status.pending_import || !status.preferences.ai_enabled) return
        setBusy(true)
        const analysis = await agentApi.brief()
        if (!alive || ticket !== epoch) return
        current = analysis
        setReport(analysis)
        if (!manual && !analysis.preferences.automatic_enabled) setOpen(false)
      } catch {
        if (alive && ticket === epoch) {
          setError('暂时无法更新简报，账本仍可正常使用。')
          if (manual) setOpen(true)
        }
      } finally {
        running = false
        if (alive) {
          setBusy(false)
          if (queued) {
            const manualNext = queuedManual
            queued = false; queuedManual = false
            clearTimeout(timer)
            timer = setTimeout(() => { timer = undefined; void check(manualNext) }, 1200)
          }
        }
      }
    }

    request.current = manual => { void check(manual) }
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type !== 'updated' || event.action.type !== 'invalidate') return
      if (!['budget-status', 'agent-preferences', 'ai-ledger-consent', 'ai-status'].includes(String(event.query.queryKey[0]))) return
      epoch += 1 // Ignore a result begun before a ledger/consent/connection change.
      if (['agent-preferences', 'ai-ledger-consent'].includes(String(event.query.queryKey[0]))) {
        current = null
        setReport(null)
        if (automaticPopup) setOpen(false)
      }
      if (running) queued = true
      else schedule(1200)
    })
    const interval = setInterval(() => { if (!document.hidden && !timer && !running) void check() }, 30000)
    const onVisible = () => { if (!document.hidden && !timer) schedule(500) }
    document.addEventListener('visibilitychange', onVisible)
    void check()
    return () => {
      alive = false; epoch += 1
      clearTimeout(timer); clearInterval(interval); unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [client, ownerId, quiet])

  return <div className="agent-entry">
    <Button variant="ghost" aria-label="查看财务简报" aria-expanded={open} aria-controls="agent-briefing" onClick={() => request.current(true)}>
      <Bell size={18}/><span className="hidden sm:inline">财务简报</span>
    </Button>
    {open && <section id="agent-briefing" role="region" aria-label="Agent 财务简报" className="agent-panel" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <header className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 font-semibold"><Sparkles size={18}/>Agent 财务简报</div><p className="mb-0 mt-1 text-xs text-muted">{report?.as_of} · 仅分析你的个人记录</p></div>
        <Button variant="ghost" aria-label="关闭简报" onClick={() => setOpen(false)}><X size={18}/></Button>
      </header>
      {report && <>
        <div className="my-3 flex items-center gap-2"><Badge tone={report.source === 'ai' ? 'success' : 'neutral'}>{report.source === 'ai' ? 'DeepSeek 建议 · 本地事实' : '本地规则'}</Badge>{busy && <span role="status" className="text-xs text-muted">正在生成 AI 建议…</span>}</div>
        <AgentCards cards={report.cards} onNavigate={() => setOpen(false)}/>
        {report.pending_import && <p className="text-xs text-muted">账单正在导入，结束后会统一更新分析。</p>}
        {report.source === 'local' && <p className="text-xs leading-5 text-muted">{reasons[report.reason] || '当前使用本地规则。'}</p>}
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <footer className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <Link to="/settings#agent-reminders" onClick={() => setOpen(false)} className="text-xs text-accent underline">提醒与 AI 授权设置</Link>
        <Button variant="ghost" disabled={busy} onClick={() => request.current(true)}>更新分析</Button>
      </footer>
    </section>}
  </div>
}

export function AgentCards({ cards, onNavigate }: { cards: AgentBrief['cards']; onNavigate?: () => void }) {
  return <div className="space-y-3">{cards.map(card => <article key={card.id} className="agent-item">
    <div className="flex items-center gap-2"><Badge tone={card.tone === 'warning' ? 'warning' : card.tone === 'encouragement' ? 'success' : 'neutral'}>{card.tone === 'warning' ? '留意' : card.tone === 'encouragement' ? '鼓励' : '建议'}</Badge><h3 className="m-0 text-sm font-semibold">{card.title}</h3></div>
    <p className="mb-2 mt-3 text-sm leading-6">{card.message}</p>
    <p className="my-2 text-xs leading-5 text-muted">依据：{card.evidence}</p>
    <Link to={card.href} onClick={onNavigate} className="text-xs font-semibold text-accent underline">查看相关记录</Link>
  </article>)}</div>
}

export function AgentReminderSettings() {
  const session = useSession()
  const client = useQueryClient()
  const queryKey = ['agent-preferences', session.data?.user.id]
  const query = useQuery({ queryKey, queryFn: agentApi.preferences, enabled: !!session.data })
  const save = useMutation({
    mutationFn: agentApi.savePreferences,
    onMutate: value => {
      client.setQueryData<Awaited<ReturnType<typeof agentApi.preferences>>>(queryKey, current =>
        current ? {
          ...current,
          automatic_enabled: value.automatic_enabled ?? current.automatic_enabled,
          ai_enabled: value.ai_enabled ?? current.ai_enabled,
        } : current)
      void client.invalidateQueries({ queryKey, refetchType: 'none' })
    },
    onSuccess: async stored => {
      client.setQueryData(queryKey, stored)
      await client.invalidateQueries({ queryKey })
    },
    onError: () => { void client.invalidateQueries({ queryKey }) },
  })
  return <Card id="agent-reminders">
    <SectionTitle title="Agent 自动提醒"/>
    {query.isPending ? <State kind="loading"/> : query.isError ? <State kind="error" retry={() => query.refetch()}/> : <div className="space-y-4 text-sm">
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={save.isPending ? save.variables.automatic_enabled ?? query.data.automatic_enabled : query.data.automatic_enabled} disabled={save.isPending} onChange={event => save.mutate({ automatic_enabled: event.target.checked })}/>打开软件和重要变化时自动提醒</label>
      <p className="m-0 leading-6 text-muted">打开软件和风险升级时更新简报，洞察进入 Story；村庄界面不自动弹窗抢占阅读。刷新、切页和同等级的小额变化不重复生成。关闭后仍能从顶部手动查看。</p>
      <p className="m-0 leading-6 text-muted">Agent 简报仅发送本人账本汇总和提醒依据；聊天按需读取最新账单。无连接或分析失败时仍提供本地提醒。</p>
    </div>}
    {save.isPending && <p role="status" className="mb-0 text-sm text-muted">正在保存；若有进行中的 AI 请求，需等待它结束。</p>}
    {save.isSuccess && <p role="status" className="mb-0 text-sm text-success">提醒设置已保存</p>}
    {save.isError && <p role="alert" className="mb-0 text-sm text-danger">保存失败，请重试。</p>}
  </Card>
}
