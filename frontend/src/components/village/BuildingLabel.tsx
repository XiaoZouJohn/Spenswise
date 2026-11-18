import { Link } from 'react-router-dom'
import { useVillage, type Building } from './VillageContext'

export function BuildingLabel({ building, active, x, y, onHover, onLeave, onFocus, onBlur }: {
  building: { id: Building; name: string; task: string; href: string }
  active: boolean; x: string; y: string; onFocus: () => void; onBlur: () => void
  onHover: () => void; onLeave: () => void
}) {
  const state = useVillage()?.business?.buildings[building.id]
  return <Link to={building.href} data-count={state?.count ?? 0} className={`building-sign ${active ? 'is-active' : ''}`}
    style={{ left: x, top: y }} onPointerEnter={onHover} onPointerLeave={onLeave} onPointerCancel={onLeave}
    onFocus={onFocus} onBlur={onBlur} aria-label={`${building.name} · ${building.task}`}>
    <span><strong>{building.name}</strong><small>{building.task}</small>{state && (state.count > 0 || building.id === 'hall') && <small className="building-business-status">{state.label}{state.count > 0 && <b>{state.count}</b>}</small>}</span>
  </Link>
}
