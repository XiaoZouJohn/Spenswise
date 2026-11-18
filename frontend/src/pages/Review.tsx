import { useSearchParams } from 'react-router-dom'
import { MonthlyReviewEditor } from '../components/village/MonthlyReviewEditor'
import { today } from '../lib/format'
import { useVillage } from '../components/village/VillageContext'

export function Review() {
  const [params, setParams] = useSearchParams()
  const village = useVillage()
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : village?.month ?? today().slice(0, 7)
  const setMonth = (month: string) => setParams({ month })
  return <div className="page review-page">
    <header className="workspace-title"><div><p>议事厅 / 回顾与安排</p><h1>月度回顾</h1></div>
      <label>盘点月份<input type="month" value={month} max={today().slice(0, 7)} onChange={event => { if (event.target.value) setMonth(event.target.value) }}/></label>
    </header>
    <MonthlyReviewEditor key={month} month={month}/>
  </div>
}
