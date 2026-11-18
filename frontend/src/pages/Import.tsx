import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, SectionTitle, State } from '../components/ui'
import { api, json } from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useSession } from '../lib/session'
import { lifeApi } from '../lib/lifeApi'
import { today } from '../lib/format'
import { journeyKey } from '../lib/journeyApi'

type Mapping = { date: string; amount: string; merchant: string | null; description: string | null; type: string | null; category: string | null }
type Preview = { token: string; columns: string[]; sample: Record<string, unknown>[]; mapping: Mapping; total: number }
type Job = { id: string; status: string; inserted: number; duplicates: number; errors: { row: number; message: string }[]; error_message?: string | null }

const jobStatusLabel: Record<string, string> = { pending: '排队中', running: '导入中', completed: '已完成', failed: '失败' }
const fields: { key: keyof Mapping; label: string; required?: boolean }[] = [
  { key: 'date', label: '日期', required: true },
  { key: 'amount', label: '金额', required: true },
  { key: 'merchant', label: '商户' },
  { key: 'description', label: '说明' },
  { key: 'type', label: '收支类型' },
  { key: 'category', label: '分类' },
]

export function ImportPanel() {
  const cache = useQueryClient()
  const [params] = useSearchParams()
  const owner = useSession().data?.user.id
  const key = `spendwise-import:${owner}`
  const history = useQuery({ queryKey: ['village-state', 'imports', owner], queryFn: () => lifeApi.state(today().slice(0, 7)) })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Mapping>({ date: '', amount: '', merchant: null, description: null, type: null, category: null })
  const [jobId, setJobId] = useState(() => params.get('job') || sessionStorage.getItem(key) || '')
  useEffect(() => { if (jobId) sessionStorage.setItem(key, jobId) }, [jobId, key])
  const upload = useMutation({
    mutationFn: async () => {
      const data = new FormData()
      data.append('file', file!)
      return api<Preview>('/import/preview', { method: 'POST', body: data })
    },
    onSuccess: result => { setPreview(result); setMapping(result.mapping) },
  })
  const confirm = useMutation({
    mutationFn: () => api<Job>('/import/confirm', json('POST', { token: preview!.token, mapping })),
    onSuccess: job => setJobId(job.id),
  })
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api<Job>(`/import/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: query => ['pending', 'running'].includes(query.state.data?.status || '') ? 1000 : false,
  })

  useEffect(() => {
    if (job.data?.status !== 'completed') return
    for (const queryKey of ['budget-status', 'budget-preview', 'overview', 'cashflow-outlook', 'transactions', 'chronicle', 'village-state', 'market-review']) {
      void cache.invalidateQueries({ queryKey: [queryKey] })
    }
    if (job.data.inserted > 0) void cache.invalidateQueries({ queryKey: journeyKey })
  }, [job.data?.status, cache])

  return <div className="space-y-5">
    {!!history.data?.jobs.length && <details className="import-history"><summary>继续查看导入任务 · {history.data.jobs.length}</summary>{history.data.jobs.map(item => <button key={item.id} className="life-reference" onClick={() => setJobId(item.id)}><span>{item.filename}</span><span>{jobStatusLabel[item.status] || item.status} · 新增 {item.inserted} · 重复 {item.duplicates} · 异常 {item.errors?.length ?? 0}</span></button>)}</details>}
    <div className="rounded-panel border border-line bg-canvas/50 p-4">
      <SectionTitle title="选择文件"/>
      <p className="text-sm text-muted">支持微信、支付宝等 CSV、TXT、XLSX 账单。系统会自动寻找表头并匹配常见字段，导入前仍可手动调整。</p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".csv,.txt,.xlsx" onChange={event => { setFile(event.target.files?.[0] || null); setPreview(null); setJobId('') }}/>
        <Button disabled={!file || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? '正在读取…' : '读取并预览'}</Button>
      </div>
      {upload.isError && <p className="mb-0 text-sm text-danger">{upload.error.message}</p>}
    </div>
    {upload.isPending && <State kind="loading" message="正在识别账单表头和字段…"/>}
    {preview && <>
      <div className="rounded-panel border border-line p-4">
        <SectionTitle title="字段映射" action={<Badge>{preview.total} 行</Badge>}/>
        <div className="grid gap-4 md:grid-cols-3">{fields.map(field => <div className="field" key={field.key}>
          <label>{field.label}{field.required ? ' *' : ''}</label>
          <select value={mapping[field.key] || ''} onChange={event => setMapping({ ...mapping, [field.key]: event.target.value || null })}>
            <option value="">不映射</option>
            {preview.columns.map(column => <option key={column} value={column}>{column}</option>)}
          </select>
        </div>)}</div>
      </div>
      <div className="rounded-panel border border-line p-4">
        <SectionTitle title="前 10 行预览"/>
        <div className="overflow-x-auto"><table><thead><tr>{preview.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.sample.map((row, index) => <tr key={index}>{preview.columns.map(column => <td key={column} className="whitespace-nowrap text-sm">{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
        <div className="mt-5 flex items-center gap-3"><Button onClick={() => confirm.mutate()} disabled={!mapping.date || !mapping.amount || confirm.isPending}>{confirm.isPending ? '正在提交…' : '确认导入'}</Button><span className="text-xs text-muted">导入结果会显示新增、重复和异常账单</span></div>
        {confirm.isError && <p className="mb-0 text-sm text-danger">{confirm.error.message}</p>}
      </div>
    </>}
    {jobId && <div className="rounded-panel border border-line p-4">
      <SectionTitle title="导入任务" action={<Badge tone={job.data?.status === 'completed' ? 'success' : job.data?.status === 'failed' ? 'danger' : 'warning'}>{jobStatusLabel[job.data?.status || ''] || '查询中'}</Badge>}/>
      {job.isLoading ? <State kind="loading"/> : job.isError ? <State kind="error" retry={() => job.refetch()}/> : job.data && <div className="space-y-2 text-sm"><p>新增 {job.data.inserted} 笔 · 重复 {job.data.duplicates} 笔 · 异常 {job.data.errors.length} 行</p>{job.data.error_message && <p className="text-danger">{job.data.error_message}</p>}{job.data.errors.map(error => <p key={error.row} className="text-danger">第 {error.row} 行：{error.message}</p>)}</div>}
      {job.data?.status === 'completed' && <Button variant="secondary" onClick={() => { window.location.assign('/ledger?review=1') }}>核对待处理记录</Button>}
    </div>}
  </div>
}

export function Import() {
  return <div className="page space-y-6"><header><p className="mb-1 text-sm text-muted">导入前核对内容</p><h1 className="m-0 text-3xl font-semibold">导入账单</h1></header><Card><ImportPanel/></Card></div>
}
