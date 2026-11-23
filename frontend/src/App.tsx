import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthPage } from './pages/Auth'
import { VillageShell } from './components/village/VillageShell'
import { AiAgreementGate } from './components/AiAgreementGate'
import { State } from './components/ui'
import { useSession } from './lib/session'
import type { BudgetStatusData } from './types'

const Simulate = lazy(() => import('./pages/Simulate').then(m => ({ default: m.Simulate })))
const Ledger = lazy(() => import('./pages/Ledger').then(m => ({ default: m.Ledger })))
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })))
const AiConnectionPage = lazy(() => import('./pages/AiConnection').then(m => ({ default: m.AiConnectionPage })))
const ComponentsPage = lazy(() => import('./pages/Components').then(m => ({ default: m.ComponentsPage })))
const UserCenter = lazy(() => import('./pages/UserCenter').then(m => ({ default: m.UserCenter })))
const FamilyWelcome = lazy(() => import('./pages/FamilyWelcome').then(m => ({ default: m.FamilyWelcome })))
const FamilyDashboardPage = lazy(() => import('./pages/FamilyDashboard').then(m => ({ default: m.FamilyDashboardPage })))
const FamilyDecisionsPage = lazy(() => import('./pages/FamilyDecisions').then(m => ({ default: m.FamilyDecisionsPage })))
const FamilyTransactionsPage = lazy(() => import('./pages/FamilyTransactions').then(m => ({ default: m.FamilyTransactionsPage })))
const FamilyBudgetPage = lazy(() => import('./pages/FamilyBudget').then(m => ({ default: m.FamilyBudgetPage })))
const FamilyGoalsPage = lazy(() => import('./pages/FamilyGoals').then(m => ({ default: m.FamilyGoalsPage })))
const FamilyMembersPage = lazy(() => import('./pages/FamilyMembers').then(m => ({ default: m.FamilyMembersPage })))
const AccountsPage = lazy(() => import('./pages/Accounts').then(m => ({ default: m.AccountsPage })))
const Review = lazy(() => import('./pages/Review').then(m => ({ default: m.Review })))
const LifeLogs = lazy(() => import('./pages/LifeLogs').then(m => ({ default: m.LifeLogs })))

export default function App() {
  const session = useSession()
  const [budgetPreview, setBudgetPreview] = useState<BudgetStatusData | null>(null)
  if (session.isLoading) return <div className="session-state"><State kind="loading" message="正在验证登录状态…"/></div>
  if (session.isError) return <div className="session-state"><State kind="error" message="无法连接服务" retry={() => session.refetch()}/></div>
  if (!session.data) return <div className="village-auth"><AuthPage/></div>
  const hasFamily = session.data.family !== null
  return <AiAgreementGate userId={session.data.user.id}><VillageShell key={session.data.user.id} session={session.data} budgetPreview={budgetPreview}>
    <Suspense fallback={<State kind="loading" message="正在打开工作区…"/>}><Routes>
      <Route path="/" element={<Navigate to="/overview" replace/>}/>
      <Route path="/overview" element={null}/>
      <Route path="/review" element={<Review/>}/>
      <Route path="/logs" element={<LifeLogs/>}/>
      <Route path="/simulate" element={<Simulate/>}/>
      <Route path="/plan" element={<Navigate to="/overview" replace/>}/>
      <Route path="/ledger" element={<Ledger/>}/>
      <Route path="/accounts" element={<AccountsPage/>}/>
      <Route path="/import" element={<Navigate to="/ledger?import=1" replace/>}/>
      <Route path="/settings" element={<SettingsPage onBudgetPreview={setBudgetPreview}/>}/>
      <Route path="/api-settings" element={<AiConnectionPage/>}/>
      <Route path="/user" element={<UserCenter/>}/>
      <Route path="/family" element={hasFamily ? <FamilyDashboardPage/> : <FamilyWelcome/>}/>
      <Route path="/family/decisions" element={hasFamily ? <FamilyDecisionsPage/> : <Navigate to="/family" replace/>}/>
      <Route path="/family/transactions" element={hasFamily ? <FamilyTransactionsPage/> : <Navigate to="/family" replace/>}/>
      <Route path="/family/budget" element={hasFamily ? <FamilyBudgetPage/> : <Navigate to="/family" replace/>}/>
      <Route path="/family/goals" element={hasFamily ? <FamilyGoalsPage/> : <Navigate to="/family" replace/>}/>
      <Route path="/family/members" element={hasFamily ? <FamilyMembersPage/> : <Navigate to="/family" replace/>}/>
      <Route path="/ai" element={null}/>
      <Route path="/components" element={<ComponentsPage/>}/>
      <Route path="*" element={<Navigate to="/overview" replace/>}/>
    </Routes></Suspense>
  </VillageShell></AiAgreementGate>
}
