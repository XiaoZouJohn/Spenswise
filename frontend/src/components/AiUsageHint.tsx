import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

type Feature = 'chat' | 'classification' | 'story' | 'agent' | 'forecast'
type Usage = {
  features: Record<Feature, { limit: number; used: number; remaining: number }>
  tokens_remaining: number
}

export function AiUsageHint({ feature, className = '' }: { feature: Feature; className?: string }) {
  const usage = useQuery({
    queryKey: ['ai-usage'],
    queryFn: () => api<Usage>('/ai/usage'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const remaining = usage.data?.features[feature]?.remaining
  if (remaining === undefined) return null
  return <small className={`ai-usage-hint ${className}`.trim()} title="每日使用次数在北京时间零点更新">
    {usage.data?.tokens_remaining === 0 || remaining === 0 ? '今日额度已用完' : `今日还可使用 ${remaining} 次`}
  </small>
}
