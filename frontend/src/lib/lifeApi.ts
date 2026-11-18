import * as sdk from '../client/generated/sdk.gen'
import type { BatchReviewIn, EventIn, LifeLogIn, LifeLogOut } from '../client/generated/types.gen'

export type Source = { type: string; id: string; label: string; href: string; deleted?: boolean }
export type LifeRecord = LifeLogOut
export type EventRecord = EventIn & { id: string; transaction_id: number; origin: string; reason: string; logs: LifeRecord[]; transaction?: { id: number; tx_date: string; merchant: string; category: string; amount_cents: number; account_key?: string | null } }
export type BuildingState = { count: number; label: string; href: string }
export type VillageState = { month: string; buildings: Record<string, BuildingState>; unclassified: number; unreviewed: number; import_errors: number; review_completed: boolean; character_hint: string; jobs: { id: string; status: string; filename: string; inserted: number; duplicates: number; errors: { row: number; message: string }[]; error_message?: string }[] }
export type CategoryReview = { category: string; amount_cents: number; previous_cents: number; change_cents: number }
export type MarketReview = { month: string; facts: { expense_cents: number; income_cents: number; net_flow_cents: number; transaction_count: number }; categories: CategoryReview[]; comparison_from: string; comparison_to: string; events: EventRecord[]; logs: LifeRecord[] }
export type StoryTask = { id: string; task_id: string; status: string; created_at: string; error_message: string; source_version: string; use_logs: boolean }
export type ChroniclePart = { chapter: string; title: string; body: string; facts: { label: string; amount_cents: number; source: Source }[]; sources: Source[] }
export type Chronicle = { month: string; facts: { income_cents: number; expense_cents: number; net_flow_cents: number; transaction_count: number }; categories: CategoryReview[]; comparison_from: string; comparison_to: string; logs: LifeRecord[]; events: EventRecord[]; review_completed: boolean; chapters: ChroniclePart[]; editions: StoryTask[]; selected_edition: StoryTask | null; stale: boolean }
export type DraftRecord<T> = { content: T; revision: number; updated_at: string | null }

export const lifeApi = {
  logs: (month?: string, transactionId?: number) => sdk.lifeLogsApiVillageLogsGet({ month, transactionId }),
  log: (logId: string) => sdk.lifeLogApiVillageLogsLogIdGet({ logId }),
  saveLog: (value: LifeLogIn, logId?: string) => logId ? sdk.updateLifeLogApiVillageLogsLogIdPut({ logId, requestBody: value }) : sdk.createLifeLogApiVillageLogsPost({ requestBody: value }),
  deleteLog: (logId: string, revision: number) => sdk.deleteLifeLogApiVillageLogsLogIdDelete({ logId, revision }),
  event: async (transactionId: number) => await sdk.consumptionEventApiVillageEventsTransactionIdGet({ transactionId }) as EventRecord,
  saveEvent: async (transactionId: number, value: EventIn) => await sdk.updateConsumptionEventApiVillageEventsTransactionIdPut({ transactionId, requestBody: value }) as EventRecord,
  batch: (value: BatchReviewIn) => sdk.reviewTransactionsApiVillageBatchReviewPost({ requestBody: value }),
  state: async (month: string) => await sdk.villageStateApiVillageStateGet({ month }) as VillageState,
  market: async (month: string) => await sdk.villageMarketApiVillageMarketGet({ month }) as MarketReview,
  story: async (month: string, editionId?: string) => await sdk.monthlyStoryApiVillageStoryMonthGet({ month, editionId }) as Chronicle,
  generate: async (month: string, useLogs: boolean, force: boolean) => await sdk.generateMonthlyStoryApiVillageStoryMonthPost({ month, requestBody: { use_logs: useLogs, force } }) as StoryTask,
  task: async (taskId: string) => await sdk.storyTaskStatusApiVillageStoryTasksTaskIdGet({ taskId }) as StoryTask,
  transactionStory: async (transactionId: number) => await sdk.transactionStoryApiVillageTransactionStoryTransactionIdGet({ transactionId }) as { edition_id: string; chapter: string; month: string; title: string }[],
  draft: async <T>(resourceType: string, resourceId: string) => await sdk.workspaceDraftApiVillageDraftsResourceTypeResourceIdGet({ resourceType, resourceId }) as DraftRecord<T>,
  saveDraft: async <T extends object>(resourceType: string, resourceId: string, content: T, revision: number, expectedOwnerId?: number) => await sdk.saveWorkspaceDraftApiVillageDraftsResourceTypeResourceIdPut({ resourceType, resourceId, requestBody: { content: content as Record<string, unknown>, revision, expected_owner_id: expectedOwnerId } }) as DraftRecord<T>,
  clearDraft: (resourceType: string, resourceId: string, revision: number, expectedOwnerId?: number) => sdk.clearWorkspaceDraftApiVillageDraftsResourceTypeResourceIdDelete({ resourceType, resourceId, revision, expectedOwnerId }),
}
