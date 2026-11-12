import { OpenAPI } from '../client/generated/core/OpenAPI'
import * as sdk from '../client/generated/sdk.gen'
import type { AgentPreferencesIn } from '../client/generated/types.gen'

OpenAPI.BASE = import.meta.env.VITE_API_URL || ''
OpenAPI.WITH_CREDENTIALS = true
OpenAPI.CREDENTIALS = 'include'

export type { AgentBrief, AgentPreferencesOut } from '../client/generated/types.gen'
export const agentApi = {
  status: () => sdk.agentStatusApiAgentStatusGet(),
  brief: () => sdk.agentBriefApiAgentBriefPost(),
  preferences: () => sdk.agentPreferencesApiAgentPreferencesGet(),
  savePreferences: (value: AgentPreferencesIn) => sdk.updateAgentPreferencesApiAgentPreferencesPut({ requestBody: value }),
}

type OpeningState = { opened: boolean; month: string; risks: Record<string, number>; lastPopup: number }
export function readOpening(key: string): OpeningState {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (value && typeof value.opened === 'boolean' && typeof value.month === 'string' &&
      typeof value.lastPopup === 'number' && value.risks && typeof value.risks === 'object' &&
      Object.values(value.risks).every(level => typeof level === 'number')) return value
  } catch { /* Private browsing may disallow storage; keep state in memory. */ }
  return { opened: false, month: '', risks: {}, lastPopup: 0 }
}
export function writeOpening(key: string, value: OpeningState) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* In-memory state still deduplicates. */ }
}
