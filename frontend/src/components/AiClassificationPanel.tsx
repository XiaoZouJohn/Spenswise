import { useMutation, useQuery } from '@tanstack/react-query'
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, json } from '../lib/api'
import type { Transaction } from '../types'
import { CategoryPicker } from './business'
import { Badge, Button, CenterDialog } from './ui'

const categories = [
  '餐饮', '交通', '购物', '居住', '医疗健康', '娱乐', '旅行', '通讯', '教育', '日用品',
  '人情往来', '收入', '退款', '转账', '其他',
]

type AiStatus = { configured: boolean; consent: boolean; model: string; endpoint: string }
type Suggestion = {
  id: number
  category: string
  confidence: number
  reason: string
  merchant?: string
  description?: string
  current_category?: string
}
type ReviewResponse = { suggestions: Suggestion[] }
type ReviewAllResponse = ReviewResponse & { total: number; groups_reviewed: number }
type CategoryUpdate = {
  updated: number
  before: { id: number; category: string; confidence: number; classification_reason: string }[]
}

export function AiClassificationPanel({
  items,
  selectedIds,
  onSaved,
}: {
  items: Transaction[]
  selectedIds: number[]
  onSaved: (before: { id: number; category: string }[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewMeta, setReviewMeta] = useState<{ total: number; groups: number } | null>(null)
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<AiStatus>('/ai/status') })

  const showReview = (data: ReviewResponse, meta: { total: number; groups: number } | null) => {
    setSuggestions(data.suggestions)
    setReviewMeta(meta)
    setReviewPage(1)
    setOpen(true)
  }

  const reviewAll = useMutation({
    mutationFn: () => api<ReviewAllResponse>('/ai/review-all-transactions', json('POST', {})),
    onSuccess: data => showReview(data, { total: data.total, groups: data.groups_reviewed }),
  })

  const reviewSelected = useMutation({
    mutationFn: (ids: number[]) => api<ReviewResponse>('/ai/review-transactions', json('POST', ids)),
    onSuccess: data => showReview(data, null),
  })

  const apply = useMutation({
    mutationFn: () => api<CategoryUpdate>(
      '/ai/apply-transaction-categories',
      json('POST', { suggestions }),
    ),
    onSuccess: result => {
      onSaved(result.before)
      setOpen(false)
      setSuggestions([])
    },
  })

  const ready = status.data?.configured && status.data?.consent
  const reviewPending = reviewAll.isPending || reviewSelected.isPending
  const reviewError = reviewAll.error || reviewSelected.error
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(suggestions.length / pageSize))
  const currentPage = Math.min(reviewPage, pageCount)
  const pagedSuggestions = suggestions.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const categorySummary = Object.entries(
    suggestions.reduce<Record<string, number>>((result, suggestion) => {
      result[suggestion.category] = (result[suggestion.category] || 0) + 1
      return result
    }, {}),
  ).sort((left, right) => right[1] - left[1])

  return <>
    <div className="mb-4 flex flex-col gap-4 rounded-panel border border-line bg-canvas p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-control bg-canvas p-2 text-accent"><Sparkles size={19}/></div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <strong>DeepSeek 智能分类</strong>
            {status.data && <Badge tone={ready ? 'success' : 'warning'}>{ready ? `${status.data.model} 已就绪` : '需要配置'}</Badge>}
          </div>
          <p className="mb-0 mt-1 text-sm leading-6 text-muted">只发送交易类型、商户和商品文本，不发送金额。AI 结果由你确认后才会写入账本。</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {!ready && <Button variant="secondary" asChild><Link to="/settings">前往设置连接并授权</Link></Button>}
        {selectedIds.length > 0 && <Button
          variant="secondary"
          disabled={!ready || reviewPending || selectedIds.length > 30}
          onClick={() => reviewSelected.mutate(selectedIds)}
        >
          只分类已选 {selectedIds.length} 笔
        </Button>}
        <Button
          disabled={!ready || reviewPending}
          onClick={() => reviewAll.mutate()}
        >
          <Sparkles size={16}/>{reviewPending ? 'DeepSeek 分类中…' : '一键分类所有账单'}
        </Button>
      </div>
      {selectedIds.length > 30 && <p className="m-0 text-sm text-danger">已选账单一次最多分类 30 笔；你仍可使用“一键分类全部”。</p>}
      {reviewError && <p role="alert" className="m-0 text-sm text-danger">分类失败：{reviewError.message}</p>}
    </div>

    <CenterDialog open={open} onOpenChange={setOpen} title="DeepSeek 分类建议">
      <p className="mt-0 text-sm leading-6 text-muted">
        {reviewMeta
          ? `已检查账本中的全部 ${reviewMeta.total} 笔账单，并按相同商户与商品合并为 ${reviewMeta.groups} 组调用 AI。`
          : `已生成 ${suggestions.length} 笔所选账单的分类建议。`}
        你可以修改或跳过某一笔，最后一键保存。
      </p>
      {categorySummary.length > 0 && <div className="mb-3 flex flex-wrap gap-2">
        {categorySummary.map(([category, count]) => <Badge key={category}>{category} {count}</Badge>)}
      </div>}
      <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
        {pagedSuggestions.map(suggestion => {
          const transaction = items.find(item => item.id === suggestion.id)
          return <div key={suggestion.id} className="rounded-control border border-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block truncate">{suggestion.merchant || transaction?.merchant || suggestion.description || transaction?.description || `账单 #${suggestion.id}`}</strong>
                <p className="mb-0 mt-1 line-clamp-2 text-xs text-muted">{suggestion.description || transaction?.description || '无商品说明'} · 原分类 {suggestion.current_category || transaction?.category || '未知'}</p>
              </div>
              <button
                type="button"
                className="rounded-control p-1 text-muted hover:bg-canvas hover:text-ink"
                aria-label={`跳过账单 ${suggestion.id}`}
                onClick={() => setSuggestions(current => current.filter(item => item.id !== suggestion.id))}
              ><X size={16}/></button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr] sm:items-center">
              <CategoryPicker
                value={suggestion.category}
                categories={categories}
                onChange={category => setSuggestions(current => current.map(item => item.id === suggestion.id ? { ...item, category } : item))}
              />
              <div className="text-xs text-muted"><Badge tone={suggestion.confidence >= 80 ? 'success' : suggestion.confidence >= 55 ? 'warning' : 'danger'}>置信度 {suggestion.confidence}%</Badge><span className="ml-2">{suggestion.reason}</span></div>
            </div>
          </div>
        })}
        {!suggestions.length && <p className="rounded-control bg-canvas p-4 text-sm text-muted">DeepSeek 没有返回可用的分类建议，请重试或手动分类。</p>}
      </div>
      {pageCount > 1 && <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
        <span>第 {currentPage} / {pageCount} 页，每页最多 {pageSize} 笔</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={currentPage <= 1} onClick={() => setReviewPage(page => Math.max(1, page - 1))}>上一页</Button>
          <Button variant="secondary" disabled={currentPage >= pageCount} onClick={() => setReviewPage(page => Math.min(pageCount, page + 1))}>下一页</Button>
        </div>
      </div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>暂不保存</Button>
        <Button disabled={!suggestions.length || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? '正在保存…' : `一键保存全部分类（${suggestions.length}）`}</Button>
      </div>
      {apply.isError && <p role="alert" className="mb-0 mt-3 text-sm text-danger">保存失败：{apply.error.message}</p>}
    </CenterDialog>
  </>
}
