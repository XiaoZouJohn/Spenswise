import { useState } from 'react'
import { AmountInput, CategoryPicker, DateRange, MetricCard, ScenarioComparison, TransactionDetail } from '../components/business'
import { FamilyCashflowRunway, FamilyGoalTracks, FamilyScenarioPreview, FamilySpendMap } from '../components/family'
import { Badge, Button, Card, DetailDialog, SectionTitle, State } from '../components/ui'
import { TransactionTable } from '../components/TransactionTable'
import { AgentCards } from '../components/AgentReminder'
import { today } from '../lib/format'
import type { ProposalPreview } from '../lib/familyApi'
import type { Transaction } from '../types'
import { LedgerPortrait, AccountsPortrait } from '../components/village/FinancialPortraits'
import { VillageDesignSystem } from '../components/village/VillageDesignSystem'
import { Paper, CharacterHint, SourceLink, DraftStatus } from '../components/village/LifeWidgets'

type ShowcaseState = 'normal' | 'loading' | 'empty' | 'error'
const sample: Transaction = { id: 1, tx_date: today(), amount_cents: 2380, tx_type: 'expense', merchant: '示例咖啡馆', description: '午间咖啡', category: '餐饮', is_fixed: false, source: '组件示例', confidence: 100, classification_reason: '组件示例' }
const nextDay = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const preview: ProposalPreview = {
  scope: 'household',
  timeline: [
    { date: nextDay(0), before_cents: 0, after_cents: 0 },
    { date: nextDay(7), before_cents: -20000, after_cents: -50000 },
    { date: nextDay(14), before_cents: -30000, after_cents: -60000 },
  ],
  minimum_before_cents: -30000,
  minimum_after_cents: -60000,
  opening_balance_cents: null,
  forecast_assumptions: ['此页仅展示组件状态'],
  goal_impact: null,
}

export function ComponentsPage() {
  const [amount, setAmount] = useState(12000)
  const [category, setCategory] = useState('餐饮')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [selected, setSelected] = useState<number[]>([])
  const [detail, setDetail] = useState<Transaction | null>(null)
  const [showcaseState, setShowcaseState] = useState<ShowcaseState>('normal')
  const showing = showcaseState === 'normal'

  return <div className="page space-y-6">
    <VillageDesignSystem/>
    <Paper title="V2 · 生活记录与来源">{showcaseState === 'loading' ? <State kind="loading"/> : showcaseState === 'error' ? <State kind="error" retry={() => setShowcaseState('normal')}/> : !showing ? <State kind="empty" message="这个月还没有生活记录"/> : <><CharacterHint text="示例：账房还有3笔账待整理"/><p className="life-log-content">组件示例：一段生活背景，不写入真实记录。</p><SourceLink source={{ type: 'ledger', id: 'example', label: '查看账本依据', href: '/ledger' }}/><SourceLink source={{ type: 'life_log', id: 'deleted', label: '来源已删除', href: '', deleted: true }}/><DraftStatus status="草稿已保存 · 组件示例" retry={() => {}}/></>}</Paper>
    <header><h1 className="m-0 text-3xl font-semibold">组件展示</h1><p className="mt-2 text-sm text-muted">开发时核对公共组件的用法与正常、加载、空数据、失败状态。本页数据不进入账本。</p></header>
    <Card><SectionTitle title="状态切换"/><div className="flex flex-wrap gap-2">{(['normal', 'loading', 'empty', 'error'] as const).map(item => <Button key={item} variant={showcaseState === item ? 'primary' : 'secondary'} onClick={() => setShowcaseState(item)}>{({ normal: '正常', loading: '加载', empty: '空数据', error: '失败' })[item]}</Button>)}</div></Card>
    <Card><SectionTitle title="村庄 · 财务对照"/>{showcaseState === 'loading' ? <State kind="loading"/> : showcaseState === 'error' ? <State kind="error" retry={() => setShowcaseState('normal')}/> : <><LedgerPortrait data={{ items: showing ? [sample] : [], total: showing ? 1 : 0, page: 1, page_size: 25, income_cents: 0, expense_cents: showing ? 2380 : 0 }}/><AccountsPortrait confirmed={false} onEdit={() => setDetail(sample)} assets={showing ? [{ id: 1, account_key: 'showcase', name: '示例现金账户', kind: 'asset', ownership: 'individual', balance_cents: 200000, as_of: today(), is_cash_account: true, include_in_family: false, archived: false, shared_account_key: null }] : []}/>{!showing && <State kind="empty" message="尚未记录资产快照"/>}</>}</Card>
    <div className="grid-metrics"><MetricCard label="指标卡片" cents={142800} detail="统一金额格式"/><MetricCard label="负值语义" cents={-2800} tone="negative"/></div>
    <Card><SectionTitle title="输入与筛选"/><div className="grid gap-4 md:grid-cols-3"><AmountInput label="金额输入" value={amount} onChange={setAmount}/><div className="field"><label>分类选择</label><CategoryPicker value={category} onChange={setCategory} categories={['餐饮', '交通', '购物']}/></div><DateRange from={from} to={to} onFrom={setFrom} onTo={setTo}/></div><div className="mt-5 flex gap-2"><Badge tone="success">已完成</Badge><Badge tone="warning">待审核</Badge><Badge tone="danger">失败</Badge></div></Card>
    <Card><SectionTitle title="交易表格与详情"/>{showcaseState === 'loading' ? <State kind="loading"/> : showcaseState === 'error' ? <State kind="error" retry={() => setShowcaseState('normal')}/> : <TransactionTable items={showing ? [sample] : []} selected={selected} onSelect={setSelected} onDetail={setDetail}/>}</Card>
    <Card><SectionTitle title="消费方案对比"/><ScenarioComparison before={300000} after={180000} minimum={85000} reserve={50000}/></Card>
    <Card><SectionTitle title="Agent 简报卡片"/>{showcaseState === 'loading' ? <State kind="loading" message="正在生成 AI 建议…"/> : showcaseState === 'error' ? <State kind="error" message="AI 不可用时保留本地提醒" retry={() => setShowcaseState('normal')}/> : <AgentCards cards={showing ? [{ id: 'demo', tone: 'warning', title: '本月总预算接近上限', evidence: '虚构示例：净支出 2400 元，限额 3000 元。', message: '可以检查本月剩余的弹性消费。', href: '/settings' }] : [{ id: 'start', tone: 'info', title: '从记录开始', evidence: '虚构示例：本月没有账单。', message: '记下一笔或导入账单，逐步了解收支。', href: '/import' }]}/>}</Card>
    <div className="grid gap-5 xl:grid-cols-2">
      {showcaseState === 'loading' ? <Card><State kind="loading"/></Card> : showcaseState === 'error' ? <Card><State kind="error" retry={() => setShowcaseState('normal')}/></Card> : <>
        <FamilyCashflowRunway days={showing ? [{ date: nextDay(0), cumulative_change_cents: 0 }, { date: nextDay(7), cumulative_change_cents: -20000 }, { date: nextDay(14), cumulative_change_cents: -30000 }] : []} events={[]}/>
        <FamilySpendMap title="共同支出矩形图" categories={showing ? [{ category: '餐饮', amount_cents: 23800, budget_cents: 30000 }, { category: '交通', amount_cents: 9500, budget_cents: 8000 }] : []}/>
        <FamilyGoalTracks goals={showing ? [{ id: 1, name: '旅行基金', target_cents: 200000, current_cents: 80000, target_date: nextDay(60) }] : []}/>
        <Card><SectionTitle title="议事方案对比"/>{showing ? <FamilyScenarioPreview preview={preview}/> : <State kind="empty"/>}</Card>
      </>}
    </div>
    <DetailDialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null) }} title="账单详情">{detail && <TransactionDetail item={detail}/>}</DetailDialog>
  </div>
}
