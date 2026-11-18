import { Link } from 'react-router-dom'
import type { Building } from './VillageContext'

export function BuildingLabel({ building, active, x, y, onFocus, onBlur }: {
  building: { id: Building; name: string; task: string; href: string }
  active: boolean; x: string; y: string; onFocus: () => void; onBlur: () => void
}) {
  return <Link to={building.href} className={`building-sign ${active ? 'is-active' : ''}`}
    style={{ left: x, top: y }} onMouseEnter={onFocus} onMouseLeave={onBlur}
    onFocus={onFocus} onBlur={onBlur} aria-label={`${building.name} · ${building.task}`}>
    <span><strong>{building.name}</strong><small>{building.task}</small></span>
  </Link>
}
