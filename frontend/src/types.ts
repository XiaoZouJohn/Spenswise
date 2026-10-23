import type { BudgetStatus, OverviewOut, Page, ScenarioIn, ScenarioResult as GeneratedResult, SettingsOut, TransactionOut } from './client/generated/types.gen'

export type OverviewData = OverviewOut
export type Transaction = TransactionOut
export type PageData = Page
export type ScenarioInput = ScenarioIn & { name: string; protected_categories: string[] }
export type ScenarioResult = GeneratedResult
export type SettingsData = SettingsOut
export type BudgetStatusData = BudgetStatus
