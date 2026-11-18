import { createContext, useContext, type ReactNode } from 'react'
import type { VillageState as BusinessState } from '../../lib/lifeApi'

export type StoryChapter = 'summary' | 'spending' | 'memories' | 'surplus' | 'next'
export type Building = 'hall' | 'ledger' | 'bank' | 'market'
export type AssistantContext = { label: string; month?: string; category?: string; building?: string }
export type AssistantDraft = { id: number; text: string }
export const chapterLabels: Record<StoryChapter, string> = {
  summary: '这个月', spending: '钱去了哪里', memories: '值得留下', surplus: '留下了什么', next: '下个月',
}
export const chapterBuildings: Record<StoryChapter, Building> = {
  summary: 'hall', spending: 'market', memories: 'ledger', surplus: 'bank', next: 'hall',
}
export const buildings: { id: Building; name: string; task: string; href: string; x: number; y: number; outline: string }[] = [
  { id: 'hall', name: '议事厅', task: '回顾与下月安排', href: '/review', x: .83, y: .13, outline: '1390,40 1840,20 1900,260 1750,315 1430,280' },
  { id: 'ledger', name: '账房', task: '收支账本', href: '/ledger', x: .53, y: .37, outline: '700,180 1150,160 1270,360 1210,530 800,560 700,420' },
  { id: 'bank', name: '钱庄', task: '账户与财富', href: '/accounts', x: .89, y: .54, outline: '1510,370 1780,290 1920,380 1920,680 1620,700 1480,560' },
  { id: 'market', name: '集市', task: '消费与回看', href: '/simulate', x: .65, y: .81, outline: '870,640 1210,600 1580,760 1560,1000 1230,1060 820,880' },
]
type VillageState = {
  month: string; business?: BusinessState
  chapter: StoryChapter; setChapter: (chapter: StoryChapter) => void
  selectedCategory: string; selectCategory: (category: string) => void
  ask: (context: AssistantContext, text?: string) => void
}
const VillageContext = createContext<VillageState | null>(null)
export function VillageProvider({ value, children }: { value: VillageState; children: ReactNode }) {
  return <VillageContext.Provider value={value}>{children}</VillageContext.Provider>
}
export function useVillage() { return useContext(VillageContext) }
