import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, json } from '../lib/api'
import { lifeApi } from '../lib/lifeApi'
import { money } from '../lib/format'
import type { PageData, Transaction } from '../types'
import { CategoryPicker } from './business'
import { AiUsageHint } from './AiUsageHint'
import { Badge, Button, CenterDialog, State } from './ui'

const categories = ['餐饮', '交通', '购物', '居住', '医疗健康', '娱乐', '旅行', '通讯', '教育', '日用品', '人情往来', '收入', '退款', '转账', '其他']

type AccountOption = { account_key: string; name: string }
type AiStatus = { configured: boolean; consent: boolean; model: string }
type Suggestion = { id: number; category: string; confidence: number; reason: string }
type ReviewResponse = { suggestions: Suggestion[]; total: number; groups_reviewed: number }
type ConfirmCandidate = { id: number; category: string; accountKey: string | null; clearAccount: boolean; suggestion?: Suggestion }

const chunks = <T,>(items: T[], size: number) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, (index + 1) * size),
)

export function PendingReviewDialog({
  open,
  onOpenChange,
  accounts,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: AccountOption[]
  onChanged: () => void
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [accountDrafts, setAccountDrafts] = useState<Record<number, string>>({})
  const [aiSuggestions, setAiSuggestions] = useState<Record<number, Suggestion>>({})
  const [aiResult, setAiResult] = useState<{ confirmed: number; manual: number } | null>(null)
  const [bulkResult, setBulkResult] = useState<{ confirmed: number; skipped: number } | null>(null)

  const queue = useInfiniteQuery({
    queryKey: ['transactions', 'pending-review-dialog'],
    enabled: open,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<PageData>(`/transactions?review=true&page=${pageParam}&page_size=100`),
    getNextPageParam: page => page.page * page.page_size < page.total ? page.page + 1 : undefined,
  })
  const items = useMemo(() => queue.data?.pages.flatMap(page => page.items) ?? [], [queue.data])
  const total = queue.data?.pages[0]?.total ?? 0
  const aiStatus = useQuery({ queryKey: ['ai-status'], queryFn: () => api<AiStatus>('/ai/status'), enabled: open })
  const aiReady = Boolean(aiStatus.data?.configured && aiStatus.data?.consent)
  const confirmCandidates = useMemo(() => {
    const candidates = new Map<number, ConfirmCandidate>()
    for (const item of items) {
      const category = drafts[item.id] || item.category
      if (category === '待确认') continue
      const accountKey = accountDrafts[item.id] || null
      candidates.set(item.id, {
        id: item.id,
        category,
        accountKey,
        clearAccount: !accountKey && Boolean(item.account_key),
        suggestion: aiSuggestions[item.id],
      })
    }
    for (const suggestion of Object.values(aiSuggestions)) {
      const category = drafts[suggestion.id] || suggestion.category
      if (category === '待确认' || candidates.has(suggestion.id)) continue
      candidates.set(suggestion.id, { id: suggestion.id, category, accountKey: null, clearAccount: false, suggestion })
    }
    return [...candidates.values()]
  }, [accountDrafts, aiSuggestions, drafts, items])

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current }
      for (const item of items) if (!(item.id in next)) next[item.id] = item.category
      return next
    })
    setAccountDrafts(current => {
      const next = { ...current }
      for (const item of items) if (!(item.id in next)) next[item.id] = item.account_key || ''
      return next
    })
  }, [items])

  const reload = async () => {
    onChanged()
    await queue.refetch()
  }

  const confirm = useMutation({
    mutationFn: (item: Transaction) => lifeApi.batch({
      ids: [item.id],
      category: drafts[item.id] === item.category ? null : drafts[item.id],
      tx_date: null,
      account_key: accountDrafts[item.id] || null,
      clear_account: !accountDrafts[item.id] && Boolean(item.account_key),
      confirmed: true,
    }),
    onSuccess: (_result, item) => {
      setAiSuggestions(current => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      void reload()
    },
  })

  const processWithAi = useMutation({
    mutationFn: async () => {
      const reviewed = await api<ReviewResponse>('/ai/review-pending-transactions', json('POST', {}))
      const confident = reviewed.suggestions.filter(item => item.confidence >= 80)
      const manual = reviewed.suggestions.filter(item => item.confidence < 80)
      for (const group of chunks(confident, 10000)) {
        if (group.length) await api('/ai/apply-transaction-categories', json('POST', { suggestions: group }))
      }
      for (const group of chunks(confident.map(item => item.id), 100)) {
        if (group.length) await lifeApi.batch({ ids: group, category: null, tx_date: null, account_key: null, clear_account: false, confirmed: true })
      }
      return { confident, manual }
    },
    onSuccess: async ({ confident, manual }) => {
      setAiSuggestions(Object.fromEntries(manual.map(item => [item.id, item])))
      setDrafts(current => ({ ...current, ...Object.fromEntries(manual.map(item => [item.id, item.category])) }))
      setAiResult({ confirmed: confident.length, manual: manual.length })
      await reload()
    },
  })

  const confirmAll = useMutation({
    mutationFn: async (candidates: ConfirmCandidate[]) => {
      const aiUpdates = candidates
        .filter(item => item.suggestion)
        .map(item => ({ ...item.suggestion!, category: item.category }))
      for (const group of chunks(aiUpdates, 10000)) {
        if (group.length) await api('/ai/apply-transaction-categories', json('POST', { suggestions: group }))
      }

      const groups = new Map<string, ConfirmCandidate[]>()
      for (const candidate of candidates) {
        const key = JSON.stringify([candidate.category, candidate.accountKey, candidate.clearAccount])
        groups.set(key, [...(groups.get(key) || []), candidate])
      }
      for (const group of groups.values()) {
        for (const batch of chunks(group, 100)) {
          await lifeApi.batch({
            ids: batch.map(item => item.id),
            category: batch[0].category,
            tx_date: null,
            account_key: batch[0].accountKey,
            clear_account: batch[0].clearAccount,
            confirmed: true,
          })
        }
      }
      return candidates.length
    },
    onSuccess: async confirmed => {
      setAiSuggestions({})
      setBulkResult({ confirmed, skipped: Math.max(0, total - confirmed) })
      await reload()
    },
  })

  const close = (next: boolean) => {
    if (!next) {
      setAiResult(null)
      setBulkResult(null)
      setAiSuggestions({})
    }
    onOpenChange(next)
  }

  return <CenterDialog open={open} onOpenChange={close} title="待处理账单" className="w-[min(94vw,900px)]">
    <div className="mb-4 flex flex-col gap-3 rounded-panel border border-accent/25 bg-accent/5 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2"><strong>需要核对 {total} 笔</strong>{aiStatus.data && <Badge tone={aiReady ? 'success' : 'warning'}>{aiReady ? `${aiStatus.data.model} 已连接` : 'DeepSeek 尚未就绪'}</Badge>}</div>
        <p className="mb-0 mt-1 text-sm leading-6 text-muted">可以逐笔修改分类或账户后确认；AI 只自动确认置信度达到 80% 的结果。</p>
      </div>
    </div>

    {aiResult && <div role="status" className="mb-4 rounded-control border border-line bg-canvas p-3 text-sm"><CheckCircle2 className="mr-2 inline text-success" size={17}/>AI 已自动确认 {aiResult.confirmed} 笔，另有 {aiResult.manual} 笔需要你人工核对。</div>}
    {bulkResult && <div role="status" className="mb-4 rounded-control border border-line bg-canvas p-3 text-sm"><CheckCircle2 className="mr-2 inline text-success" size={17}/>已一键确认 {bulkResult.confirmed} 笔{bulkResult.skipped ? `；还有 ${bulkResult.skipped} 笔尚未选择明确分类。` : '，待处理账单已全部确认。'}</div>}
    {processWithAi.isError && <p role="alert" className="rounded-control bg-danger/10 p-3 text-sm text-danger">AI 处理失败：{processWithAi.error.message}</p>}
    {confirmAll.isError && <p role="alert" className="rounded-control bg-danger/10 p-3 text-sm text-danger">一键确认失败：{confirmAll.error.message}</p>}

    {queue.isLoading ? <State kind="loading" message="正在读取待处理账单…"/> : queue.isError ? <State kind="error" message={queue.error.message} retry={() => queue.refetch()}/> : items.length === 0 ? <State kind="empty" message="没有待处理账单，当前账本已核对完成"/> : <div className="max-h-[54vh] space-y-3 overflow-y-auto pr-1">
      {items.map(item => {
        const suggestion = aiSuggestions[item.id]
        const chosen = drafts[item.id] || item.category
        return <article key={item.id} className="rounded-panel border border-line bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><strong className="truncate">{item.merchant || item.description || `账单 #${item.id}`}</strong><Badge tone={item.confidence >= 80 ? 'success' : item.confidence >= 55 ? 'warning' : 'danger'}>原置信度 {item.confidence}%</Badge>{suggestion && <Badge tone="warning">AI 建议 {suggestion.confidence}%</Badge>}</div>
              <p className="mb-0 mt-1 text-sm text-muted">{item.tx_date} · {item.tx_type === 'income' ? '收入' : item.tx_type === 'refund' ? '退款' : item.tx_type === 'transfer' ? '转账' : '支出'} · {money(item.amount_cents)}</p>
              <p className="mb-0 mt-1 line-clamp-2 text-xs text-muted">{suggestion?.reason ? `DeepSeek：${suggestion.reason}` : item.classification_reason || item.description || '暂无分类说明'}</p>
            </div>
            <div className="grid shrink-0 gap-2 sm:grid-cols-[150px_170px_auto] sm:items-center">
              <CategoryPicker value={chosen} categories={categories} onChange={value => setDrafts(current => ({ ...current, [item.id]: value }))}/>
              <select aria-label={`账单 ${item.id} 的所属账户`} value={accountDrafts[item.id] ?? ''} onChange={event => setAccountDrafts(current => ({ ...current, [item.id]: event.target.value }))}><option value="">未关联账户</option>{accounts.map(account => <option key={account.account_key} value={account.account_key}>{account.name}</option>)}</select>
              <Button disabled={confirm.isPending || chosen === '待确认'} onClick={() => confirm.mutate(item)}>确认</Button>
            </div>
          </div>
        </article>
      })}
      {queue.hasNextPage && <div className="flex justify-center pt-2"><Button variant="secondary" disabled={queue.isFetchingNextPage} onClick={() => queue.fetchNextPage()}>{queue.isFetchingNextPage ? '正在加载…' : `加载更多（已显示 ${items.length} / ${total}）`}</Button></div>}
    </div>}
    {confirm.isError && <p role="alert" className="mb-0 mt-3 text-sm text-danger">确认失败：{confirm.error.message}</p>}
    <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 text-sm leading-6 text-muted">AI 仅发送交易类型、商户和商品文本，不会发送金额；不确定项仍由你决定。</p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="secondary" disabled={!aiReady || processWithAi.isPending || confirmAll.isPending || total === 0} onClick={() => processWithAi.mutate()}><Sparkles size={16}/>{processWithAi.isPending ? 'DeepSeek 处理中…' : 'AI 一键处理'}</Button>
        <AiUsageHint feature="classification"/>
        <Button disabled={confirmAll.isPending || processWithAi.isPending || confirmCandidates.length === 0} onClick={() => confirmAll.mutate(confirmCandidates)}><CheckCircle2 size={16}/>{confirmAll.isPending ? '正在确认…' : `一键确认全部（${confirmCandidates.length}）`}</Button>
      </div>
    </div>
  </CenterDialog>
}
