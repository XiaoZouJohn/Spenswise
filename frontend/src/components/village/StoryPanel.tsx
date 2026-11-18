import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVillageOverview, ledgerHref, safeEvidenceHref } from '../../lib/village'
import { money } from '../../lib/format'
import { useSession } from '../../lib/session'
import type { AgentBrief } from '../../lib/agent'
import { State } from '../ui'
import { Illustration } from './Illustration'
import { StoryAction, StoryChapter, StoryMetrics } from './StoryParts'
import { chapterLabels, useVillage, type StoryChapter as Chapter } from './VillageContext'

const chapters = Object.keys(chapterLabels) as Chapter[]

export function Story() {
  const village = useVillage()
  const session = useSession()
  const overview = useQuery({ queryKey: ['overview'], queryFn: getVillageOverview })
  const brief = useQuery<AgentBrief | null>({
    queryKey: ['agent-report', session.data?.user.id], queryFn: () => null, enabled: false,
  })
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = scroll.current
    if (!root) return
    const update = () => {
      if (!root.clientHeight) return
      const box = root.getBoundingClientRect()
      const target = Math.max(0, box.top) + Math.min(root.clientHeight, window.innerHeight) * .22
      const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-story-chapter]'))
      const current = sections.find(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.top <= target && bounds.bottom > target
      })
      if (current) village?.setChapter(current.dataset.storyChapter as Chapter)
    }
    root.addEventListener('scroll', update, { passive: true })
    window.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', update)
      window.removeEventListener('scroll', update)
    }
  }, [overview.isSuccess, village?.setChapter])

  function jump(chapter: Chapter) {
    village?.setChapter(chapter)
    const target = document.getElementById(`story-${chapter}`)
    const root = scroll.current
    if (!target || !root) return
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 18, behavior })
  }

  if (overview.isPending) return <div className="story-paper"><State kind="loading" message="正在整理本月账本…"/></div>
  const data = overview.data
  if (overview.isError || !data) return <div className="story-paper"><State kind="error" message="暂时无法读取本月账本" retry={() => overview.refetch()}/></div>

  const report = brief.data
  const matchingReport = report && report.month === data.month
    && report.facts.transaction_count === data.transaction_count
    && report.facts.income_cents === data.income_cents
    && report.facts.spent_cents === Math.max(0, data.expense_cents)
    && brief.dataUpdatedAt >= overview.dataUpdatedAt
  const surplus = data.net_flow_cents ?? 0
  const headline = !data.transaction_count ? '从第一笔记录，开始本月故事。'
    : surplus > 0 ? '本月收入，留有结余。'
    : surplus < 0 ? '本月净支出超过收入。' : '本月记录的收支持平。'
  const updated = new Date(overview.dataUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const monthLabel = `${data.month.slice(0, 4)} 年 ${Number(data.month.slice(5))} 月`
  const categories = [...data.category_spend].sort((a, b) => b.amount_cents - a.amount_cents)
  const ask = (chapter: Chapter, category?: string) => village?.ask({
    label: chapterLabels[chapter], month: data.month, category,
  }, `请结合我的账本解释${category ? `“${category}”的支出情况` : chapterLabels[chapter]}，指出依据和数据覆盖范围。`)

  return <article className="story-paper" aria-label="本月财务 Story" data-testid="village-story">
    <header className="story-masthead">
      <Illustration name="ledger"/>
      <div><h1>本月财务故事</h1><p>{monthLabel}</p></div>
    </header>
    <nav className="story-index" aria-label="Story 章节">{chapters.map((id, index) => <button key={id} onClick={() => jump(id)} className={village?.chapter === id ? 'is-active' : ''} aria-current={village?.chapter === id ? 'step' : undefined}>
      <span>{index + 1}</span>{chapterLabels[id]}
    </button>)}</nav>
    <div className="story-reading-stage" aria-live="polite"><span>正在阅读</span><strong>{chapterLabels[village?.chapter ?? 'summary']}</strong><span>{chapters.indexOf(village?.chapter ?? 'summary') + 1} / {chapters.length}</span></div>
    <div ref={scroll} className="story-scroll" tabIndex={0} aria-label="财务故事正文">
      <section id="story-summary" data-story-chapter="summary" className="story-opening">
        <Illustration name="merchant" className="story-merchant"/>
        <p className="story-eyebrow">本月概览</p><h2 className="story-lead-title">{headline}</h2>
        <p>{data.transaction_count ? `已记录 ${data.transaction_count} 笔流水，回看收入与消费的去向。` : '添加或导入账单，让收入、消费与结余连成一条故事。'}</p>
        <StoryMetrics income={data.income_cents} expense={data.expense_cents} surplus={surplus}/>
        {!data.transaction_count && <StoryAction to="/ledger?import=1">添加或导入账单</StoryAction>}
        <p className="story-coverage">个人账本 · 更新于 {updated}</p>
      </section>
      <StoryChapter id="income" number="01 / 来源" title="记录下来的收入">
        <div className="story-amount income-amount">{money(data.income_cents)}</div>
        <Link className="story-source-row" to={ledgerHref(data.month, undefined, 'income')} onMouseEnter={() => village?.setChapter('income')}>
          <Illustration name="income"/><div><span>本月收入记录</span><strong>{money(data.income_cents)}</strong><span className="story-data-bar"><i style={{ width: data.income_cents > 0 ? '100%' : '0%' }}/></span></div><span aria-hidden="true">↗</span>
        </Link>
        <p>收入明细可在账房核对。来源细分及历史对比待服务端提供聚合。</p>
        <StoryAction to={ledgerHref(data.month, undefined, 'income')}>核对收入记录</StoryAction>
      </StoryChapter>
      <StoryChapter id="spending" number="02 / 去向" title="资金流向日常生活">
        <div className="story-amount expense-amount">{money(data.expense_cents)}</div>
        <p>净支出已扣退款，转账不计收支。</p>
        {categories.length ? <div className="story-categories">{categories.map(item => {
          const ratio = data.expense_cents > 0 && item.amount_cents >= 0 ? item.amount_cents / data.expense_cents * 100 : null
          return <Link key={item.category} to={ledgerHref(data.month, item.category)} className={village?.selectedCategory === item.category ? 'is-selected' : ''}
            onFocus={() => { village?.selectCategory(item.category); village?.setChapter('spending') }}
            onMouseEnter={() => { village?.selectCategory(item.category); village?.setChapter('spending') }}>
            <span className="story-category-name">{item.category}</span><strong>{money(item.amount_cents)}</strong>
            <span className="story-data-bar"><i style={{ width: `${Math.min(100, ratio ?? 0)}%` }}/></span>
            <small>{ratio === null ? '净退款' : `${ratio.toFixed(0)}%`}</small>
          </Link>
        })}</div> : <p className="story-note">本月尚无消费分类。</p>}
        <button className="story-text-action" onClick={() => ask('spending', village?.selectedCategory)}>请助手解释这项支出 ↗</button>
      </StoryChapter>
      <StoryChapter id="surplus" number="03 / 留下" title="本月的收支结余">
        <div className="story-surplus"><Illustration name="surplus"/><strong>{money(surplus)}</strong></div>
        <p>本月收入减净支出。账户期初资金、借贷与估值变化需在钱庄核对。</p>
        <p className="story-note">当前汇总未提供上月同期数据。</p>
        <StoryAction to="/accounts">前往钱庄核对账户</StoryAction>
      </StoryChapter>
      <StoryChapter id="next" number="04 / 展望" title="接下来值得关注的事情">
        <div className="story-insight"><Illustration name="insight"/><div><h3>预算执行</h3><p>{data.budget_remaining_cents < 0 ? `本月已超预算 ${money(-data.budget_remaining_cents)}。` : `本月预算尚余 ${money(data.budget_remaining_cents)}。`}</p><StoryAction to="/simulate">先比较下一项消费计划</StoryAction></div></div>
        {matchingReport && report.cards.map(card => <div className="story-insight" key={card.id}>
          <Illustration name="insight"/><div><h3>{card.title}</h3><p>{card.message}</p><p className="story-evidence">依据 · {card.evidence}</p><StoryAction to={safeEvidenceHref(card.href)}>核对相关记录</StoryAction></div>
        </div>)}
        <StoryAction to="/review">整理本月背景与安排</StoryAction>
      </StoryChapter>
      <p className="story-footnote">人民币 · 本月已记录账本<br/>收支结余与账户余额、净资产使用独立口径。</p>
    </div>
    <footer className="story-footer"><button className="story-primary" onClick={() => ask(village?.chapter ?? 'summary')}>继续与 AI 助手对话 <span aria-hidden="true">↗</span></button><Illustration name="sprig"/></footer>
  </article>
}
