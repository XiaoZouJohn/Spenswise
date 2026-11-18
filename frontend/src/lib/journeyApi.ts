import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { journeyApiVillageJourneyGet, updateJourneyApiVillageJourneyPut } from '../client/generated/sdk.gen'
import type { JourneyOut } from '../client/generated/types.gen'
import './api'
import { useSession } from './session'

export type JourneyTip = 'ledger' | 'story' | 'assistant'
export type JourneyAchievement = { code: 'login_3' | 'login_7' | 'logs_1' | 'logs_5' | 'plan_2' | 'plan_3'; unlocked_at: string | null }
export type Journey = JourneyOut

export const journeyKey = ['village-journey'] as const
export function useJourney() {
  const owner = useSession().data?.user.id
  return useQuery({ queryKey: [...journeyKey, owner], queryFn: journeyApiVillageJourneyGet, enabled: !!owner })
}
export function useUpdateJourney() {
  const client = useQueryClient()
  const owner = useSession().data?.user.id
  return useMutation({
    mutationFn: async (change: { dismiss_welcome?: boolean; seen_tip?: JourneyTip; replay?: boolean }) => {
      if (!owner) throw new Error('需要先登录')
      const current = await client.fetchQuery({ queryKey: [...journeyKey, owner], queryFn: journeyApiVillageJourneyGet })
      return updateJourneyApiVillageJourneyPut({ requestBody: { revision: current.revision, ...change } })
    },
    onSuccess: data => client.setQueryData([...journeyKey, owner], data),
    onError: () => void client.invalidateQueries({ queryKey: journeyKey }),
  })
}
