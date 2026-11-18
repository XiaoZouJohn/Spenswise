import { useState } from 'react'
import { MonthlyReviewEditor } from '../components/village/MonthlyReviewEditor'
import { today } from '../lib/format'

export function Review() {
  const [month, setMonth] = useState(today().slice(0, 7))
  return <div className="page review-page">
    <header className="workspace-title"><div><p>政务中心 / 回顾与安排</p><h1>月度盘点</h1></div>
      <label>盘点月份<input type="month" value={month} max={today().slice(0, 7)} onChange={event => { if (event.target.value) setMonth(event.target.value) }}/></label>
    </header>
    <MonthlyReviewEditor key={month} month={month}/>
  </div>
}
