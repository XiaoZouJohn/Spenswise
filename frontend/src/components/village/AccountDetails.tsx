import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { familyApi, type AccountSnapshot } from '../../lib/familyApi'
import { api } from '../../lib/api'
import type { PageData } from '../../types'
import { money } from '../../lib/format'
import { Button, State } from '../ui'
import { Paper } from './LifeWidgets'
import { Chart } from '../Chart'
import { chartColors } from '../../lib/tokens'

export function AccountDetails({ accountKey, onEdit }: { accountKey: string; onEdit: (row: AccountSnapshot) => void }) {
  const assets = useQuery({ queryKey: ['assets'], queryFn: familyApi.assets })
  const rows = useQuery({ queryKey: ['transactions', 'account', accountKey], queryFn: () => api<PageData>(`/transactions?account_key=${encodeURIComponent(accountKey)}&page_size=20`) })
  const history = (assets.data ?? []).filter(row => row.account_key === accountKey).sort((a, b) => a.as_of.localeCompare(b.as_of) || a.id - b.id)
  const latest = history[history.length - 1]
  if (assets.isPending) return <State kind="loading"/>
  if (assets.isError) return <State kind="error" retry={() => assets.refetch()}/>
  if (!latest) return <State kind="empty" message="账户不存在或已移除"/>
  return <div className="account-details"><Paper title={latest.name}><p>最近快照 · {latest.as_of}{latest.archived ? ' · 已归档' : ''}</p><strong className="account-balance">{money(latest.balance_cents)}</strong><p>这是主动填写的余额快照，不由收支结余推算。</p>{!latest.archived && <Button onClick={() => onEdit(latest)}>更新账户快照</Button>}</Paper>
    <Paper title="余额变化记录">{history.length > 1 && <Chart height={210} option={{ color: [chartColors[0]], grid: { left: 65, right: 12, top: 15, bottom: 35 }, tooltip: { trigger: 'axis', valueFormatter: value => money(Number(value)) }, xAxis: { type: 'category', data: history.map(row => row.as_of) }, yAxis: { type: 'value', axisLabel: { formatter: value => money(Number(value)) } }, series: [{ type: 'line', smooth: .15, data: history.map(row => row.balance_cents), areaStyle: { opacity: .12 } }] }}/>}<div className="snapshot-history">{history.slice().reverse().map(row => <div key={row.id}><time>{row.as_of}</time><span>快照 #{row.id}</span><strong>{money(row.balance_cents)}</strong></div>)}</div></Paper>
    <Paper title="已关联流水">{rows.isPending ? <State kind="loading"/> : rows.isError ? <State kind="error" retry={() => rows.refetch()}/> : !rows.data.items.length ? <p>尚未关联流水。可在账房选择记录后，批量关联至此账户；不会猜测旧账单的所属账户。</p> : rows.data.items.map(row => <Link className="life-reference" key={row.id} to={`/ledger?ids=${row.id}&detail=${row.id}`}><time>{row.tx_date}</time><span>{row.merchant || row.category}</span><strong>{money(row.amount_cents)}</strong></Link>)}<Link className="story-action" to={`/ledger?account_key=${encodeURIComponent(accountKey)}`}>查看账户全部流水 ↗</Link></Paper>
  </div>
}
