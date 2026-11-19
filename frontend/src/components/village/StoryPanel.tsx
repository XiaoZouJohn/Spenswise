import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { BookOpenCheck, CalendarDays } from 'lucide-react'
import { lifeApi } from '../../lib/lifeApi'
import { money, today } from '../../lib/format'
import { useSession } from '../../lib/session'
import { State, Button } from '../ui'
import { AiMarkdown } from '../AiMarkdown'
import { Illustration } from './Illustration'
import { CharacterHint } from './LifeWidgets'
import { chapterLabels, useVillage, type StoryChapter } from './VillageContext'
import { ledgerHref } from '../../lib/village'
import { JourneyTipCard } from './VillageJourney'
import { journeyKey } from '../../lib/journeyApi'

const chapters = Object.keys(chapterLabels) as StoryChapter[]
const navigationLabels: Record<StoryChapter, string> = {
  summary: '本月概况', spending: '收入来源', memories: '消费去向', surplus: '重要记录', next: '下月计划',
}
const chapterActions: Record<StoryChapter, { href: string; label: string }> = {
  summary: { href: '/ledger', label: '去账房核对' },
  spending: { href: '/simulate?view=spending', label: '去集市回看' },
  memories: { href: '/logs', label: '去账房记录' },
  surplus: { href: '/accounts', label: '去钱庄核对' },
  next: { href: '/review', label: '去议事厅规划' },
}

export function Story() {
  const village = useVillage()
  const owner = useSession().data?.user.id
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : village?.month ?? today().slice(0, 7)
  const edition = params.get('edition') || undefined
  const scroll = useRef<HTMLDivElement>(null)
  const restored = useRef('')
  const reduced = useReducedMotion()
  const query = useQuery({ queryKey: ['chronicle', owner, month, edition], queryFn: () => lifeApi.story(month, edition),
    refetchInterval: current => current.state.data?.editions.some(item => ['pending', 'running'].includes(item.status)) ? 2500 : false })
  const completedEdition = query.data?.editions.find(item => item.status === 'completed')?.id ?? null
  useEffect(() => { if (completedEdition) void client.invalidateQueries({ queryKey: journeyKey }) }, [completedEdition, client])
  const generate = useMutation({ mutationFn: () => lifeApi.generate(month, true, true), onSuccess: () => client.invalidateQueries({ queryKey: ['chronicle'] }) })
  const progressKey = `spendwise-story-progress:${owner}:${month}`
  const currentChapter = village?.chapter ?? 'summary'

  function jump(chapter: StoryChapter) {
    village?.setChapter(chapter)
    localStorage.setItem(progressKey, chapter)
    const target = document.getElementById(`story-${chapter}`)
    const root = scroll.current
    if (target && root) root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 18, behavior: reduced ? 'instant' : 'smooth' })
  }
  useEffect(() => {
    const root = scroll.current
    if (!root) return
    const token = `${month}:${params.get('chapter') || ''}`
    if (restored.current !== token) {
      const saved = params.get('chapter') || localStorage.getItem(progressKey)
      restored.current = token
      requestAnimationFrame(() => jump(chapters.includes(saved as StoryChapter) ? saved as StoryChapter : 'summary'))
    }
    const update = () => {
      const bounds = root.getBoundingClientRect()
      const position = bounds.top + root.clientHeight * .18
      for (const section of root.querySelectorAll<HTMLElement>('[data-story-chapter]')) {
        const rect = section.getBoundingClientRect()
        if (rect.top <= position && rect.bottom > position) {
          const chapter = section.dataset.storyChapter as StoryChapter
          village?.setChapter(chapter)
          localStorage.setItem(progressKey, chapter)
          break
        }
      }
    }
    root.addEventListener('scroll', update, { passive: true })
    return () => root.removeEventListener('scroll', update)
    // Reading restoration intentionally follows month and explicit deep links, not every scroll update.
  }, [query.isSuccess, month, params.get('chapter')])

  if (query.isPending) return <div className="story-paper"><State kind="loading" message="正在整理本月生活与账簿…"/></div>
  if (query.isError || !query.data) return <div className="story-paper"><State kind="error" retry={() => query.refetch()}/></div>
  const data = query.data
  const task = data.editions.find(item => ['pending', 'running'].includes(item.status))
  const latest = data.editions[0]
  const completed = data.editions.filter(item => item.status === 'completed')
  const busy = generate.isPending || !!task
  const [year, selectedMonth] = month.split('-')
  const updatedDate = data.selected_edition
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(data.selected_edition.created_at)).replaceAll('-', '/')
    : today().replaceAll('-', '/')
  const ask = () => village?.ask({ label: chapterLabels[currentChapter], month }, `请结合我当前阅读的${month}纪事“${chapterLabels[currentChapter]}”，先核对本人账本和明确允许AI使用的生活记录，再区分事实与判断。`)

  return <article className="story-paper" aria-label="本月财务回顾" data-testid="village-story">
    <header className="story-masthead"><Illustration name="ledger"/><div className="story-masthead-copy"><h1>本月财务回顾</h1><p>更新于 {updatedDate}</p></div><label className="story-month-picker"><span className="story-month-caption">回顾月份</span><span className="story-month-value" aria-hidden="true"><b>{year}</b><span>年</span><b>{selectedMonth}</b><span>月</span><CalendarDays size={17} strokeWidth={1.7}/></span><input aria-label="回顾月份" type="month" value={month} max={today().slice(0, 7)} onClick={event => { if (event.currentTarget.showPicker) event.currentTarget.showPicker() }} onChange={event => { if (event.target.value) setParams({ month: event.target.value }) }}/></label></header>
    <JourneyTipCard kind="story"/>
    <div className="story-generation"><Button disabled={busy} onClick={() => generate.mutate()}><BookOpenCheck size={16} strokeWidth={1.8}/>{busy ? '正在生成回顾…' : completed.length ? '重新生成回顾' : '生成本月回顾'}</Button>
      <label className="story-version-picker"><span>历史版本</span><select aria-label="历史版本" value={edition || ''} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('edition', event.target.value); else next.delete('edition'); setParams(next) }}><option value="">最新版本</option><option value="facts">当前账本事实</option>{completed.map((item, index) => <option key={item.id} value={item.id}>{month.replace('-', '年')}月 · 第{completed.length - index}版</option>)}</select></label>
      <p>将依据本月账目生成，并参考你允许使用的生活记录。</p>
      {(generate.isError || latest?.status === 'failed') && <p role="alert">{latest?.error_message || '无法整理，请检查 AI 连接与授权后重试。'}</p>}
      {data.stale && <p role="status">账本或生活记录有更新，可以重新生成回顾。</p>}
      {task && <p role="status">{task.status === 'pending' ? '任务排队中' : '正在组织纪事'} · 离开后可回来查看</p>}
    </div>
    <nav className="story-index" aria-label="Story 章节">{chapters.map((chapter, index) => <button key={chapter} onClick={() => jump(chapter)} className={currentChapter === chapter ? 'is-active' : ''} aria-current={currentChapter === chapter ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{navigationLabels[chapter]}</button>)}</nav>
    <div className="story-reading-stage"><span>当前章节 · <strong>{navigationLabels[currentChapter]}</strong></span><span>{chapters.indexOf(currentChapter) + 1} / 5</span></div>
    <div ref={scroll} className="story-scroll" tabIndex={0} aria-label="生活纪事正文">
      {data.chapters.map((part, index) => {
        const chapter = part.chapter as StoryChapter
        return <motion.section key={`${edition || 'latest'}-${chapter}`} id={`story-${chapter}`} data-story-chapter={chapter} className={currentChapter === chapter ? 'is-current' : ''} initial={{ opacity: reduced ? 1 : 0 }} whileInView={{ opacity: 1 }} viewport={{ root: scroll, once: true, amount: .1 }} transition={{ duration: .18 }}>
          <div className="story-chapter-heading"><span className="story-chapter-number">{String(index + 1).padStart(2, '0')}</span><div><p className="story-chapter-label">{chapterLabels[chapter]}</p><h2>{part.title}</h2></div></div>
          {index === 0 && <Illustration name="merchant" className="story-merchant"/>}
          <AiMarkdown content={part.body} className="story-narrative"/>
          <div className="story-fact-lines">{part.facts.slice(0, 3).map(fact => <Link key={fact.label} to={fact.source?.href || ledgerHref(month)}><span>{fact.label}</span><strong>{money(fact.amount_cents)}</strong></Link>)}</div>
          {chapter === 'spending' && <div className="story-categories">{data.categories.map(item => <Link key={item.category} to={`${ledgerHref(month, item.category)}`} onMouseEnter={() => village?.selectCategory(item.category)}><span>{item.category}</span><strong>{money(item.amount_cents)}</strong><small>上月同期 {money(item.previous_cents)}</small><small>{item.change_cents > 0 ? '+' : ''}{money(item.change_cents)}</small></Link>)}</div>}
          {chapter === 'memories' && <div className="story-memory-list">{data.logs.slice(0, 5).map(log => <Link key={log.id} to={`/logs?log=${log.id}`}><time>{log.event_date}</time><strong>{log.title || log.content.slice(0, 30)}</strong><span>{log.content.slice(0, 100)}</span></Link>)}<Link className="story-action" to={`/logs?new=1&month=${month}`}>值得留下的一件事 ↗</Link></div>}
          {chapter === 'next' && data.review_completed && <p className="review-completed">本月回顾已完成</p>}
          <div className="story-chapter-actions"><Link to={chapterActions[chapter].href} className="story-action">{chapterActions[chapter].label} <span aria-hidden="true">↗</span></Link></div>
        </motion.section>
      })}
      <CharacterHint text={village?.business?.character_hint || '想起值得留下的事，随时记下来。'}/>
    </div>
    <footer className="story-footer"><button className="story-primary" onClick={ask}>就当前纪事问问助手 ↗</button><Illustration name="sprig"/></footer>
  </article>
}
