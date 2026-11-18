import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Building2, Compass, Settings, UserRound, UsersRound } from 'lucide-react'
import { AgentReminder } from '../AgentReminder'
import { BudgetWarning } from '../BudgetWarning'
import { Overview } from '../../pages/Overview'
import { VillageScene } from './VillageScene'
import { AiLauncher, type AiBubblePosition } from '../AiLauncher'
import { Illustration } from './Illustration'
import { buildings, chapterLabels, VillageProvider, type AssistantContext, type AssistantDraft, type StoryChapter } from './VillageContext'
import { lifeApi } from '../../lib/lifeApi'
import { today } from '../../lib/format'
import type { Session } from '../../lib/familyApi'
import type { BudgetStatusData } from '../../types'
const AiChatWindow = lazy(() => import('../AiChatWindow').then(m => ({ default: m.AiChatWindow })))

const familyNav = [
  ['/family', '家庭财务'], ['/family/transactions', '家庭收支'], ['/family/decisions', '家庭议事板'],
  ['/family/budget', '共同预算'], ['/family/goals', '共同目标'], ['/family/members', '成员与权限'],
]
export function VillageShell({ session, budgetPreview, children }: { session: Session; budgetPreview: BudgetStatusData | null; children: ReactNode }) {
  const location = useLocation()
  const reducedMotion = useReducedMotion()
  const returnFocus = useRef<HTMLAnchorElement | null>(null)
  const family = location.pathname.startsWith('/family')
  const home = ['/', '/overview', '/ai', '/plan'].includes(location.pathname)
  const [chapter, setChapter] = useState<StoryChapter>('summary')
  const [selectedCategory, selectCategory] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [bubblePosition, setBubblePosition] = useState<AiBubblePosition>(() => ({ x: window.innerWidth - 80, y: window.innerHeight - 80 }))
  const [aiMounted, setAiMounted] = useState(false)
  const [context, setContext] = useState<AssistantContext | null>(null)
  const [draft, setDraft] = useState<AssistantDraft | undefined>()
  const [menu, setMenu] = useState(false)
  const [conversation, setConversation] = useState<string | null>(null)
  const monthParameter = new URLSearchParams(location.search).get('month')
  const validMonth = monthParameter && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParameter) ? monthParameter : null
  const [month, setMonth] = useState(validMonth ?? today().slice(0, 7))
  useEffect(() => { if (validMonth) setMonth(validMonth) }, [validMonth])
  const [compactMode, setCompactMode] = useState<'story' | 'places' | 'workspace'>('story')
  const restoreFocus = useRef<HTMLElement | null>(null)
  const overview = useQuery({ queryKey: ['market-review', month], queryFn: () => lifeApi.market(month) })
  const business = useQuery({ queryKey: ['village-state', session.user.id, month], queryFn: () => lifeApi.state(month), refetchInterval: 30000 })
  const workspace = !home
  const current = location.pathname.startsWith('/ledger') ? buildings[1] : location.pathname === '/accounts' ? buildings[2] : location.pathname === '/simulate' ? buildings[3] : buildings[0]
  const ask = useCallback((value: AssistantContext, text?: string) => {
    restoreFocus.current = document.activeElement as HTMLElement
    setContext(value); if (text) setDraft({ id: Date.now(), text })
    setAiMounted(true); setAiOpen(true)
  }, [])
  const closeAssistant = useCallback(() => { setAiOpen(false); restoreFocus.current?.focus() }, [])
  useEffect(() => { setCompactMode(workspace ? 'workspace' : 'story') }, [location.pathname, workspace])
  useEffect(() => {
    setMenu(false)
    if (!workspace) requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }))
    if (family) { setAiOpen(false); setContext(null) }
    if (location.pathname === '/ai') {
      setConversation(new URLSearchParams(location.search).get('conversation'))
      setAiMounted(true); setAiOpen(true)
    }
  }, [location.pathname, location.search, family, workspace])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); if (aiOpen) closeAssistant() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aiOpen, closeAssistant])
  return <VillageProvider value={{ chapter, setChapter, selectedCategory, selectCategory, ask, month, business: business.data }}>
    <div className={`village-shell village-v2 ${workspace ? 'has-workspace' : 'is-home'}`} data-compact-mode={compactMode} style={{ '--village-canvas-width': '100%', '--village-panel-height': 'calc(100dvh - 170px)' } as CSSProperties}>
      <VillageScene chapter={chapter} selectedCategory={selectedCategory} categoryAmount={overview.data?.categories.find(item => item.category === selectedCategory)?.amount_cents} workspace={workspace} hasData={!!overview.data?.facts.transaction_count} flow={overview.data ? { income: overview.data.facts.income_cents, expense: overview.data.facts.expense_cents } : undefined}/>
      <a className="skip-to-content" href="#village-content">跳到主要内容</a>
      <header className="village-topbar">
        <Link to="/overview" className="village-brand"><Illustration name="village"/><span>富贵村<small>SPENDWISE</small></span></Link>
        <div className="village-space-switch" aria-label="财务空间"><NavLink to="/overview" className={!family ? 'is-active' : ''}>个人空间</NavLink><NavLink to="/family" className={family ? 'is-active' : ''}><UsersRound size={14}/>家庭组</NavLink></div>
        <div className="village-header-actions"><AgentReminder ownerId={session.user.id} quiet/><Link to="/settings#ai-connection" aria-label="设置" className="village-icon-button"><Settings size={18}/></Link><Link to="/user" className="village-user" aria-label="个人资料"><UserRound size={17}/><span>{session.user.display_name}</span></Link></div>
      </header>
      <nav className="village-district-nav" aria-label="地点导航">
        <Link to="/overview" className={home ? 'is-active' : ''}><Illustration name="ledger"/>本月 Story</Link>
        {buildings.map(b => <NavLink to={b.href} key={b.id} className={!home && current.id === b.id && !family ? 'is-active' : ''}>{b.name}<span>{b.task}</span></NavLink>)}
        <button onClick={() => setMenu(v => !v)} aria-expanded={menu}><Compass size={15}/>全部地点</button>
      </nav>
      {menu && <nav className="village-location-menu" aria-label="全部地点">{buildings.map(b => <Link to={b.href} key={b.id} onClick={() => setMenu(false)}>{b.name}<span>{b.task}</span><ArrowUpRight size={15}/></Link>)}<Link to="/logs" onClick={() => setMenu(false)}>生活记录<Illustration name="ledger"/></Link><Link to="/family" onClick={() => setMenu(false)}>家庭事务<UsersRound size={15}/></Link><Link to="/user" onClick={() => setMenu(false)}>个人资料<UserRound size={15}/></Link><Link to="/settings" onClick={() => setMenu(false)}>预算与设置<Settings size={15}/></Link></nav>}
      <nav className="compact-navigation" aria-label="紧凑视图">{(['story', 'places', 'workspace'] as const).map((value, index) => <button key={value} aria-pressed={compactMode === value} onClick={() => setCompactMode(value)}>{['Story', '地点', '工作区'][index]}</button>)}</nav>
      <main id="village-content" className="village-main" tabIndex={-1} onClickCapture={event => {
        const target = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href="/overview"]')
        if (target) returnFocus.current = document.querySelector<HTMLAnchorElement>(`.building-sign[href="${current.href}"]`)
      }}>
        {home && children}
        <div className="village-story-slot"><Overview/></div>
        <nav className="compact-places" aria-label="建筑地点">{buildings.map(building => <Link to={building.href} key={building.id}><Illustration name={building.id}/><span><strong>{building.name}</strong><small>{building.task}</small></span><span>{business.data?.buildings[building.id]?.label}</span></Link>)}</nav>
        {home && <aside className="village-entry-actions"><Link className="story-action" to={`/overview?month=${month}&chapter=${chapter}`}>继续本月 Story ↗</Link>{business.data && <>{Object.entries(business.data.buildings).filter(([, state]) => state.count > 0).map(([key, state]) => <Link key={key} to={state.href}>{state.label}<strong>{state.count}</strong></Link>)}{business.data.review_completed && <span>本月回顾已完成</span>}</>}<Link to="/logs">生活记录 ↗</Link></aside>}
        <AnimatePresence mode="wait">{workspace && <motion.section key={location.pathname} initial={{ opacity: 0, x: reducedMotion ? 0 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reducedMotion ? 0 : 16 }} transition={{ duration: reducedMotion ? 0 : .28, ease: 'easeOut' }} className="building-workspace" aria-label={`${family ? '家庭空间' : current.name}工作区`}>
          <header className="building-workspace-head"><span><Building2 size={15}/>{family ? '议事厅 · 家庭事务' : `${current.name} · ${current.task}`}</span><Link to="/overview"><ArrowLeft size={16}/>返回村庄</Link></header>
          {family && session.family && <nav className="building-tabs" aria-label="家庭功能">{familyNav.map(([href, label]) => <NavLink key={href} end={href === '/family'} to={href}>{label}</NavLink>)}</nav>}
          {!family && current.id === 'hall' && <nav className="building-tabs" aria-label="议事厅功能"><NavLink to="/review">月度回顾</NavLink><NavLink to="/logs">生活记录</NavLink><NavLink to="/settings">预算与设置</NavLink><NavLink to="/family">家庭事务</NavLink><NavLink to="/user">个人资料</NavLink></nav>}
          <div className="workspace-content" key={location.pathname}>{children}</div>
        </motion.section>}</AnimatePresence>
      </main>
      {!family && <div className="village-budget-strip"><BudgetWarning draft={budgetPreview} autoOpen={false}/></div>}
      {!family && <AiLauncher onOpen={position => {
        restoreFocus.current = document.activeElement as HTMLElement
        setBubblePosition(position)
        ask({ label: home ? chapterLabels[chapter] : current.task, month, building: home ? undefined : current.name, category: selectedCategory || undefined })
      }}/>} 
      {aiMounted && <Suspense fallback={null}><AiChatWindow open={aiOpen && !family} onCollapse={closeAssistant} bubblePosition={bubblePosition} initialConversationId={conversation} villageContext={context} onClearContext={() => setContext(null)} suggestedDraft={draft}/></Suspense>}

    </div>
  </VillageProvider>
}
