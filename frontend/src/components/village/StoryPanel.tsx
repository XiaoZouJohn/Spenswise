import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { lifeApi } from '../../lib/lifeApi'
import { money, today } from '../../lib/format'
import { useSession } from '../../lib/session'
import { State, Button } from '../ui'
import { AiMarkdown } from '../AiMarkdown'
import { Illustration } from './Illustration'
import { CharacterHint, SourceLink } from './LifeWidgets'
import { chapterLabels, useVillage, type StoryChapter } from './VillageContext'
import { ledgerHref } from '../../lib/village'

const chapters = Object.keys(chapterLabels) as StoryChapter[]
const chapterActions: Record<StoryChapter, string> = {
  summary: '/ledger', spending: '/simulate?view=spending', memories: '/logs', surplus: '/accounts', next: '/review',
}

export function Story() {
  const village = useVillage()
  const owner = useSession().data?.user.id
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : village?.month ?? today().slice(0, 7)
  const edition = params.get('edition') || undefined
  const [useLogs, setUseLogs] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const restored = useRef('')
  const reduced = useReducedMotion()
  const query = useQuery({ queryKey: ['chronicle', owner, month, edition], queryFn: () => lifeApi.story(month, edition),
    refetchInterval: current => current.state.data?.editions.some(item => ['pending', 'running'].includes(item.status)) ? 2500 : false })
  const generate = useMutation({ mutationFn: () => lifeApi.generate(month, useLogs, true), onSuccess: () => client.invalidateQueries({ queryKey: ['chronicle'] }) })
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
  const busy = generate.isPending || !!task
  const ask = () => village?.ask({ label: chapterLabels[currentChapter], month }, `请结合我当前阅读的${month}纪事“${chapterLabels[currentChapter]}”，先核对本人账本和明确允许AI使用的生活记录，再区分事实与判断。`)

  return <article className="story-paper" aria-label="本月生活纪事" data-testid="village-story">
    <header className="story-masthead"><Illustration name="ledger"/><div><h1>本月生活纪事</h1><p>{data.selected_edition ? new Date(data.selected_edition.created_at).toLocaleDateString('zh-CN') + ' 整理' : '已记录的生活与账本'}</p></div><input aria-label="纪事月份" type="month" value={month} max={today().slice(0, 7)} onChange={event => { if (event.target.value) setParams({ month: event.target.value }) }}/></header>
    <div className="story-generation"><Button variant="ghost" disabled={busy} onClick={() => generate.mutate()}>{busy ? '正在整理纪事…' : '整理本月纪事'}</Button>
      <details><summary>使用范围与历史版本</summary><label><input type="checkbox" checked={useLogs} onChange={event => setUseLogs(event.target.checked)}/>本次使用允许AI读取的生活记录及本月回顾</label><p>账本沿用已有 AI 授权；日志需逐篇允许。整理后保存版本，页面滚动不会调用模型。</p>
        <select aria-label="纪事版本" value={edition || ''} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('edition', event.target.value); else next.delete('edition'); setParams(next) }}><option value="">最新纪事</option><option value="facts">当前账本事实</option>{data.editions.filter(item => item.status === 'completed').map((item, index) => <option key={item.id} value={item.id}>历史版 {data.editions.length - index} · {new Date(item.created_at).toLocaleString('zh-CN')}</option>)}</select>
      </details>
      {(generate.isError || latest?.status === 'failed') && <p role="alert">{latest?.error_message || '无法整理，请检查 AI 连接与授权后重试。'}</p>}
      {data.stale && <p role="status">账本或生活记录已更新，可重新整理本月纪事。</p>}
      {task && <p role="status">{task.status === 'pending' ? '任务排队中' : '正在组织纪事'} · 离开后可回来查看</p>}
    </div>
    <nav className="story-index" aria-label="Story 章节">{chapters.map((chapter, index) => <button key={chapter} onClick={() => jump(chapter)} className={currentChapter === chapter ? 'is-active' : ''} aria-current={currentChapter === chapter ? 'step' : undefined}><span>{index + 1}</span>{chapterLabels[chapter]}</button>)}</nav>
    <div className="story-reading-stage"><span>正在阅读</span><strong>{chapterLabels[currentChapter]}</strong><span>{chapters.indexOf(currentChapter) + 1} / 5</span></div>
    <div ref={scroll} className="story-scroll" tabIndex={0} aria-label="生活纪事正文">
      {data.chapters.map((part, index) => {
        const chapter = part.chapter as StoryChapter
        return <motion.section key={`${edition || 'latest'}-${chapter}`} id={`story-${chapter}`} data-story-chapter={chapter} className={currentChapter === chapter ? 'is-current' : ''} initial={{ opacity: reduced ? 1 : 0 }} whileInView={{ opacity: 1 }} viewport={{ root: scroll, once: true, amount: .1 }} transition={{ duration: .18 }}>
          <div className="story-chapter-heading"><span className="story-chapter-number">{String(index + 1).padStart(2, '0')}</span><div><p className="story-chapter-label">{chapterLabels[chapter]}</p><h2>{part.title}</h2></div></div>
          {index === 0 && <Illustration name="merchant" className="story-merchant"/>}
          <AiMarkdown content={part.body} className="story-narrative"/>
          <div className="story-fact-lines">{part.facts.slice(0, 3).map(fact => <Link key={fact.label} to={fact.source?.href || ledgerHref(month)}><span>{fact.label}</span><strong>{money(fact.amount_cents)}</strong></Link>)}</div>
          {chapter === 'spending' && <div className="story-categories">{data.categories.map(item => <Link key={item.category} to={`${ledgerHref(month, item.category)}`} onMouseEnter={() => village?.selectCategory(item.category)}><span>{item.category}</span><strong>{money(item.amount_cents)}</strong><small>同口径上月 {money(item.previous_cents)}</small><small>{item.change_cents > 0 ? '+' : ''}{money(item.change_cents)}</small></Link>)}</div>}
          {chapter === 'memories' && <div className="story-memory-list">{data.logs.slice(0, 5).map(log => <Link key={log.id} to={`/logs?log=${log.id}`}><time>{log.event_date}</time><strong>{log.title || log.content.slice(0, 30)}</strong><span>{log.content.slice(0, 100)}</span></Link>)}<Link className="story-action" to={`/logs?new=1&month=${month}`}>值得留下的一件事 ↗</Link></div>}
          {chapter === 'next' && data.review_completed && <p className="review-completed">本月回顾已完成</p>}
          <details className="story-sources"><summary>查看依据 · {part.sources.length} 项来源</summary><div className="source-links">{part.sources.map(source => <SourceLink key={`${source.type}-${source.id}`} source={source}/>)}</div></details>
          <div className="story-chapter-actions"><Link to={chapterActions[chapter]} className="story-action">直接处理 ↗</Link>{index < 4 && <button className="story-text-action" onClick={() => jump(chapters[index + 1])}>跳过本章 →</button>}</div>
        </motion.section>
      })}
      <CharacterHint text={village?.business?.character_hint || '只记下对你有意义的事。其余的可以稍后再看。'}/>
    </div>
    <footer className="story-footer"><button className="story-primary" onClick={ask}>就当前纪事问问助手 ↗</button><Illustration name="sprig"/></footer>
  </article>
}
