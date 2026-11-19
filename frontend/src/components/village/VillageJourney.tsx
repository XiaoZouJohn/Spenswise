import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useJourney, useUpdateJourney, type JourneyTip } from '../../lib/journeyApi'

const cat = '/media/village/cat/'
const achievementArt = '/media/village/achievements/'
export const keepsakes = [
  { code: 'login_3', title: '连续登录 3 天', detail: '每天来看看，连续登录即可获得', href: '/overview', image: 'login-3.png' },
  { code: 'login_7', title: '连续登录 7 天', detail: '每天来看看，连续登录即可获得', href: '/overview', image: 'login-7.png' },
  { code: 'logs_1', title: '完成 1 篇日志', detail: '保存一篇生活记录', href: '/logs', image: 'logs-1.png' },
  { code: 'logs_5', title: '完成 5 篇日志', detail: '保存五篇生活记录', href: '/logs', image: 'logs-5.png' },
  { code: 'plan_2', title: '连续 2 个月达成收支计划', detail: '每月保存回顾，留有结余且消费在预算内', href: '/review', image: 'plan-2.png' },
  { code: 'plan_3', title: '连续 3 个月达成收支计划', detail: '每月保存回顾，留有结余且消费在预算内', href: '/review', image: 'plan-3.png' },
] as const

const tips: Record<JourneyTip, { title: string; body: string; image: string }> = {
  ledger: { title: '从真实账目开始', body: '导入前可以预览；确认后才会写进账房。你也可以直接手记一笔。', image: 'guide.png' },
  story: { title: '账目会变成故事', body: '看看这个月的收支，也可以切换月份生成回顾。', image: 'read.png' },
  assistant: { title: '随时问问小猫', body: '可以问小猫账目和图表，也可以请它带你去相关地点。', image: 'guide.png' },
}
export function JourneyTipCard({ kind, className = '' }: { kind: JourneyTip; className?: string }) {
  const { data } = useJourney()
  const update = useUpdateJourney()
  if (!data || data.show_welcome || data.tour_step > 0 || data.seen_tips.includes(kind) || (kind === 'ledger' && data.has_transactions) || (kind === 'story' && !data.has_transactions)) return null
  const tip = tips[kind]
  return <aside className={`journey-tip ${className}`} aria-label={`${tip.title} · 使用提示`}><img src={`${cat}${tip.image}`} alt=""/><div><strong>{tip.title}</strong><p>{tip.body}</p></div><button aria-label={`知道了：${tip.title}`} disabled={update.isPending} onClick={() => update.mutate({ seen_tip: kind })}>知道了</button></aside>
}

export const tourSteps = [
  { title: '从本月 Story 开始｜看看这个月的收支', path: '/overview', target: '.story-paper', body: '每个月的收支，都是一段值得回顾的小故事。跟着左侧的章节，看看收入从哪里来、钱花去了哪里，还有哪些事情值得记下。你可以切换月份、跳转章节，也可以点击数字，随时回到账目中寻找细节。' },
  { title: '村庄就是你的财务地图｜认识村里的四座建筑', path: '/overview', target: '.village-district-nav', body: '村里的每座建筑都有自己的工作。账房替你收好每一笔流水，钱庄帮你照看账户与财富，集市可以预演未来的消费安排，议事厅则陪你回顾每个月的收支。想去哪里，点击建筑或上方的地点导航就好。' },
  { title: '账房 · 把每一笔收支安顿好', path: '/ledger', target: '.ledger-toolbar', body: '今天买了什么？又收到了哪笔收入？来账房记上一笔吧。你也可以把微信、支付宝的账单带过来，核对导入内容后统一入账。记完之后，还能慢慢整理分类、筛选流水，随时翻看每一笔开销的来龙去脉。' },
  { title: '钱庄 · 看看手里的财富', path: '/accounts', target: '.building-workspace-head', body: '现金、银行卡、其他资产，还有尚未偿还的负债，都可以在这里登记。定期更新账户余额，留下每次盘点的记录。无论是查看账户流水，还是比较不同时期的财富变化，都能在钱庄找到答案。' },
  { title: '集市 · 为下一笔开销做个打算', path: '/simulate', target: '.building-workspace-head', body: '想买一件东西，或者正在计划下个月的生活？不妨先来集市逛逛。从账房带入消费类别，调整计划金额，看看不同选择会给预算和现金流带来怎样的变化。满意的方案可以保存下来，留待之后比较。' },
  { title: '议事厅 · 坐下来，回顾这个月', path: '/review', target: '.building-workspace-head', body: '忙碌了一个月，也该给自己留一点盘点的时间。议事厅会整理好本月的收支事实，你可以写下这个月发生了什么、有哪些值得注意的变化，以及下个月准备做些什么。保存这份月度回顾，让每个月的财务变化都有迹可循。预算与相关设置也可以在这里找到。' },
  { title: '生活记录 · 给每一笔开销一个故事', path: '/logs', target: '.life-logs-page', body: '一笔消费背后，往往还有一段值得记住的经历。一次旅行、一顿聚餐，或者一个深思熟虑后的决定，都可以写在这里。你可以关联已有账单，也可以单独记录生活中的点滴。愿意的话，还可以授权 AI 参考这些记录，让它在分析收支时多了解一点你的真实生活。' },
  { title: 'AI 助手 · 有问题，随时问问小猫', path: '/overview', target: '.ai-launcher', body: '看不懂某笔账目？想知道最近的钱都花去了哪里？或者正在考虑下一步怎么安排？点击角落里的小猫，随时和财务助手聊聊。它可以结合你正在查看的章节和地点回答问题。对话窗还可以拖动、缩放或收起，方便你一边整理账目，一边交流想法。' },
  { title: '家庭组 · 和家人一起打理生活', path: '/family', target: '.building-workspace-head', body: '一个人的账本可以记录自己的生活，一家人的账本则能装下更多共同的计划。邀请家人加入，设置账目共享范围，一起查看家庭预算、共同目标和议事提案。个人空间与家庭空间可以随时切换，各自的生活与共同的安排都能妥善安顿。' },
  { title: '预算 · 安排每月花费', path: '/settings', target: '.building-workspace-head', body: '在这里设置每月总预算，再给餐饮、交通等类别分配额度。以后想调整计划，回到议事厅就能找到预算。' },
  { title: '个人中心 · 收藏一路走来的小成就', path: '/user', target: '.journey-album', body: '每一次坚持记录，都值得留下一枚纪念。来个人中心看看自己的成就吧：连续登录、完成生活日志、持续达成月度收支计划，都可能为你带来新的勋章。这里也可以管理个人资料、登录设备和导出数据。忘记了村里的路线？随时点击顶栏的「使用指引」，再来看看就好。' },
] as const

export function JourneyTour({ step, introToken, onMove, onPause }: { step: number; introToken: number; onMove: (step: number) => void; onPause: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const item = tourSteps[step - 1]
  const card = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<CSSProperties>({})
  const [intro, setIntro] = useState(step === 1)
  useEffect(() => { setIntro(true); const timeout = window.setTimeout(() => setIntro(false), 1300); return () => window.clearTimeout(timeout) }, [introToken])
  useEffect(() => {
    if (!item || location.pathname !== item.path) return
    let marked: Element | null = null
    const place = () => {
      if (!marked || window.innerWidth < 700) { setPosition({}); return }
      const rect = marked.getBoundingClientRect()
      const width = card.current?.offsetWidth || 390
      const height = card.current?.offsetHeight || 270
      const gap = 18
      let left: number
      let top: number
      if (window.innerWidth - rect.right >= width + gap) {
        left = rect.right + gap; top = rect.top
      } else if (rect.left >= width + gap) {
        left = rect.left - width - gap; top = rect.top
      } else if (window.innerHeight - rect.bottom >= height + gap) {
        left = rect.left; top = rect.bottom + gap
      } else {
        left = rect.left; top = rect.top - height - gap
      }
      setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(top, window.innerHeight - height - 12)), right: 'auto', bottom: 'auto' })
    }
    const mark = () => {
      const mobileDestinations = step === 2 && window.matchMedia('(max-width: 1100px)').matches
      const target = document.querySelector(mobileDestinations ? '.mobile-village-destinations' : item.target)
      if (target === marked) return
      marked?.classList.remove('journey-highlight')
      target?.classList.add('journey-highlight')
      marked = target
      place()
    }
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer.disconnect(); marked?.classList.remove('journey-highlight'); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [item, location.pathname])
  if (!item) return null
  if (location.pathname === '/ledger' && new URLSearchParams(location.search).has('import')) return null
  if (location.pathname === '/ledger' && new URLSearchParams(location.search).has('new')) return null
  const here = location.pathname === item.path
  return <><aside ref={card} style={position} className={`journey-tour ${intro ? 'is-starting' : ''}`} aria-label="富贵村使用指引" aria-live="polite"><div className="journey-tour-head"><img src={`${cat}${step > 7 ? 'read.png' : 'guide.png'}`} alt=""/><div><span>使用指引 · {step} / {tourSteps.length}</span><h2>{item.title}</h2></div><button aria-label="稍后继续指引" onClick={onPause}>×</button></div>
    <div className="journey-tour-progress"><span style={{ width: `${step / tourSteps.length * 100}%` }}/></div>
    <p>{item.body}</p>
    <div className="journey-tour-actions"><button onClick={() => onMove(0)}>结束指引</button><button disabled={step === 1} onClick={() => onMove(step - 1)}>上一步</button>{here ? <button className="is-primary" onClick={() => onMove(step === tourSteps.length ? 0 : step + 1)}>{step === tourSteps.length ? '完成指引' : '下一步'}</button> : <button className="is-primary" onClick={() => navigate(item.path)}>前往这里</button>}</div>
    {step === 3 && here && <div className="journey-tour-shortcuts"><button onClick={() => navigate('/ledger?import=1')}>打开导入账单</button><button onClick={() => navigate('/ledger?new=1')}>手记一笔</button></div>}
    <details className="journey-tour-index"><summary>查看全部 {tourSteps.length} 个部分</summary><div>{tourSteps.map((part, index) => <button key={part.title} className={index + 1 === step ? 'is-current' : ''} onClick={() => onMove(index + 1)}>{String(index + 1).padStart(2, '0')} · {part.title}</button>)}</div></details>
  </aside>{intro && step === 1 && <div className="journey-start-cue" role="status"><img src={`${cat}wave.png`} alt=""/><span>小猫正在带你认识富贵村</span></div>}</>
}

export function VillageAlbum() {
  const { data, isPending, isError, error, refetch } = useJourney()
  return <section className="journey-album" aria-labelledby="journey-album-title"><div className="journey-album-head"><div><p className="journey-eyebrow">富贵村 · 使用记录</p><h2 id="journey-album-title">我的成就</h2><p>每一次坚持记录，都值得留下纪念。</p></div><img src={`${cat}read.png`} alt="读账簿的小猫"/></div>
    {isPending ? <p>正在翻阅纪念册…</p> : isError ? <div role="alert"><p>成就暂时无法读取。{error instanceof Error ? error.message : '请稍后重试。'}</p><button onClick={() => void refetch()}>重新读取</button></div> : <><div className="journey-stamps">{keepsakes.map(item => { const earned = data?.achievements.find(a => a.code === item.code)?.unlocked_at; return <Link to={item.href} className={`journey-stamp ${earned ? 'is-earned' : ''}`} key={item.code}><img className="journey-stamp-art" src={`${achievementArt}${item.image}`} alt="" loading="lazy"/><strong>{item.title}</strong><small>{earned ? `获得于 ${new Date(earned).toLocaleDateString('zh-CN')}` : item.detail}</small></Link> })}</div><p className="journey-album-count">已收藏 {data?.achievements.filter(item => item.unlocked_at).length ?? 0} / {keepsakes.length} 枚纪念</p></>}
  </section>
}

export function JourneyAwardNotice() {
  const { data } = useJourney()
  const previous = useRef<string[] | null>(null)
  const [award, setAward] = useState<string | null>(null)
  useEffect(() => {
    if (!data) return
    const earned = data.achievements.filter(item => item.unlocked_at).map(item => item.code)
    if (previous.current) {
      const gained = earned.find(code => !previous.current?.includes(code))
      if (gained) setAward(gained)
    }
    previous.current = earned
  }, [data])
  useEffect(() => { if (!award) return; const timeout = window.setTimeout(() => setAward(null), 6000); return () => window.clearTimeout(timeout) }, [award])
  const item = keepsakes.find(item => item.code === award)
  if (!item) return null
  return <div className="journey-award" role="status"><img className="journey-award-art" src={`${achievementArt}${item.image}`} alt=""/><div><strong>获得纪念 · {item.title}</strong><Link to="/user#journey-album-title" onClick={() => setAward(null)}>查看纪念册 ↗</Link></div><button aria-label="关闭纪念提示" onClick={() => setAward(null)}>×</button></div>
}
