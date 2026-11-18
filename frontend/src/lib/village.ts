import { api } from './api'
import { today } from './format'
import type { OverviewData } from '../types'

export const getVillageOverview = () => api<OverviewData>('/overview')
// Filter navigation refers to the same natural month as the server summary.
export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { from: today().slice(0, 7) + '-01', to: today() }
  const [year, value] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year, value, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${end}` }
}
export function ledgerHref(month: string, category?: string, txType?: string) {
  const range = monthRange(month)
  const params = new URLSearchParams({ date_from: range.from, date_to: range.to })
  if (category) params.set('category', category)
  if (txType) params.set('tx_type', txType)
  return `/ledger?${params}`
}
export function safeEvidenceHref(href: string) {
  // Agent evidence is a navigation suggestion, never an executable external link.
  const route = href.split(/[?#]/)[0]
  return ['/ledger', '/settings', '/simulate', '/accounts', '/overview', '/review', '/import'].includes(route) ? href : '/ledger'
}
