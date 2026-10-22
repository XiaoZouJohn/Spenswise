import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { LayoutDashboard, SlidersHorizontal, ReceiptText, Upload, Settings, UsersRound, CalendarRange, ChartNoAxesCombined, WalletCards, Target, UserRound } from 'lucide-react'
import { Overview } from './pages/Overview'
import { Simulate } from './pages/Simulate'
import { Ledger } from './pages/Ledger'
import { Import } from './pages/Import'
import { SettingsPage } from './pages/Settings'
import { ComponentsPage } from './pages/Components'
import { AuthPage } from './pages/Auth'
import { UserCenter } from './pages/UserCenter'
import { FamilyWelcome } from './pages/FamilyWelcome'
import { FamilyDashboardPage } from './pages/FamilyDashboard'
import { FamilyDecisionsPage } from './pages/FamilyDecisions'
import { FamilyTransactionsPage } from './pages/FamilyTransactions'
import { FamilyBudgetPage } from './pages/FamilyBudget'
import { FamilyGoalsPage } from './pages/FamilyGoals'
import { FamilyMembersPage } from './pages/FamilyMembers'
import { AccountsPage } from './pages/Accounts'
import { BudgetWarning } from './components/BudgetWarning'
import { AiLauncher } from './components/AiLauncher'
import type { AiBubblePosition } from './components/AiLauncher'
import { AiChatWindow } from './components/AiChatWindow'
import { State } from './components/ui'
import { useSession } from './lib/session'
import type { BudgetStatusData } from './types'

const personalNav = [
  { path: '/overview', label: '概览', icon: LayoutDashboard },
  { path: '/simulate', label: '消费模拟', icon: SlidersHorizontal },
  { path: '/ledger', label: '账本', icon: ReceiptText },
  { path: '/accounts', label: '账户与资产', icon: WalletCards },
  { path: '/import', label: '导入', icon: Upload },
  { path: '/settings', label: '设置', icon: Settings },
]
const familyNav = [
  { path: '/family', label: '家庭财务', icon: UsersRound },
  { path: '/family/decisions', label: '家庭议事板', icon: CalendarRange },
  { path: '/family/transactions', label: '家庭收支', icon: ChartNoAxesCombined },
  { path: '/family/budget', label: '共同预算', icon: WalletCards },
  { path: '/family/goals', label: '共同目标', icon: Target },
  { path: '/family/members', label: '成员与权限', icon: UserRound },
]

export default function App() {
  const session = useSession()
  const [budgetPreview, setBudgetPreview] = useState<BudgetStatusData | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMounted, setAiMounted] = useState(false)
  const [bubblePosition, setBubblePosition] = useState<AiBubblePosition>({ x: 24, y: window.innerHeight - 84 })
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null)
  const location = useLocation()
  const isFamily = location.pathname.startsWith('/family')

  useEffect(() => {
    if (location.pathname !== '/ai') return
    setInitialConversationId(new URLSearchParams(location.search).get('conversation'))
    setAiMounted(true)
    setAiOpen(true)
  }, [location.pathname, location.search])
  useEffect(() => { if (isFamily) setAiOpen(false) }, [isFamily])

  if (session.isLoading) return <div className="grid min-h-screen place-items-center"><State kind="loading" message="正在验证登录状态…"/></div>
  if (session.isError) return <div className="grid min-h-screen place-items-center"><State kind="error" message="无法连接服务" retry={() => session.refetch()}/></div>
  if (!session.data) return <AuthPage/>
  const hasFamily = session.data.family !== null
  const nav = isFamily ? familyNav : personalNav
  const showNav = !isFamily || hasFamily

  return <div className="min-h-screen lg:flex">
    <aside className="border-b border-line bg-white lg:min-h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="px-6 py-7 text-xl font-bold tracking-tight text-accent">SpendWise</div>
      {showNav && <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0">
        {nav.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/family'} className={({ isActive }) => 'flex shrink-0 items-center gap-3 rounded-control px-4 py-3 text-sm font-medium ' + (isActive ? 'bg-accent text-white' : 'text-muted hover:bg-canvas hover:text-ink')}>
          <Icon size={17}/>{label}
        </NavLink>)}
      </nav>}
    </aside>
    <main className="min-w-0 flex-1">
      <div className="family-topbar"><div className="flex items-center gap-1"><Link to="/overview" className={'family-space-link ' + (!isFamily ? 'is-active' : '')}>个人空间</Link><Link to="/family" className={'family-space-link ' + (isFamily ? 'is-active' : '')}>家庭组</Link></div><Link to="/user" className="family-account-link"><UserRound size={18}/><span className="max-w-32 truncate">{session.data.user.display_name}</span></Link></div>
      {!isFamily && <BudgetWarning draft={budgetPreview}/>}
      <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace/>}/>
          <Route path="/overview" element={<Overview/>}/>
          <Route path="/simulate" element={<Simulate/>}/>
          <Route path="/plan" element={<Navigate to="/overview" replace/>}/>
          <Route path="/ledger" element={<Ledger/>}/>
          <Route path="/accounts" element={<AccountsPage/>}/>
          <Route path="/import" element={<Import/>}/>
          <Route path="/settings" element={<SettingsPage onBudgetPreview={setBudgetPreview}/>}/>
          <Route path="/user" element={<UserCenter/>}/>
          <Route path="/family" element={hasFamily ? <FamilyDashboardPage/> : <FamilyWelcome/>}/>
          <Route path="/family/decisions" element={hasFamily ? <FamilyDecisionsPage/> : <Navigate to="/family" replace/>}/>
          <Route path="/family/transactions" element={hasFamily ? <FamilyTransactionsPage/> : <Navigate to="/family" replace/>}/>
          <Route path="/family/budget" element={hasFamily ? <FamilyBudgetPage/> : <Navigate to="/family" replace/>}/>
          <Route path="/family/goals" element={hasFamily ? <FamilyGoalsPage/> : <Navigate to="/family" replace/>}/>
          <Route path="/family/members" element={hasFamily ? <FamilyMembersPage/> : <Navigate to="/family" replace/>}/>
          <Route path="/ai" element={<Navigate to="/overview" replace/>}/>
          <Route path="/components" element={<ComponentsPage/>}/>
        </Routes>
      </motion.div>
    </main>
    {!isFamily && !aiOpen && <AiLauncher onOpen={position => { setBubblePosition(position); setAiMounted(true); setAiOpen(true) }}/>} 
    {!isFamily && aiMounted && <AiChatWindow open={aiOpen} onCollapse={() => setAiOpen(false)} bubblePosition={bubblePosition} initialConversationId={initialConversationId}/>}
  </div>
}
