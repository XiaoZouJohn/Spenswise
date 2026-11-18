import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Illustration, type IllustrationName } from './Illustration'
import { money } from '../../lib/format'
import { useVillage } from './VillageContext'

export function StoryChapter({ id, number, title, children }: {
  id: string; number: string; title: string; children: ReactNode
}) {
  const village = useVillage()
  return <section id={`story-${id}`} data-story-chapter={id} className={village?.chapter === id ? 'is-current' : ''}>
    <div className="story-chapter-heading"><span className="story-chapter-number">{number.split(' / ')[0]}</span><div><p className="story-chapter-label">{number.split(' / ')[1]}</p><h2>{title}</h2></div></div>
    {children}
  </section>
}

export function StoryMetrics({ income, expense, surplus }: { income: number; expense: number; surplus: number }) {
  const metrics: { name: string; value: number; art: IllustrationName }[] = [
    { name: '收入', value: income, art: 'income' },
    { name: '净支出', value: expense, art: 'expense' },
    { name: '收支结余', value: surplus, art: 'surplus' },
  ]
  return <dl className="story-metrics">{metrics.map(metric => <div key={metric.art}>
    <dt><Illustration name={metric.art}/>{metric.name}</dt>
    <dd>{money(metric.value)}</dd>
  </div>)}</dl>
}

export function StoryAction({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="story-action" to={to}>{children}<span aria-hidden="true">↗</span></Link>
}
