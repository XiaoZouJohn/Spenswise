import { useEffect, useRef, useState } from 'react'
import { villageMedia } from '../../lib/villageMedia'
import { Link, useLocation } from 'react-router-dom'
import { buildings, type Building, type StoryChapter } from './VillageContext'
import { BuildingLabel } from './BuildingLabel'
import { money } from '../../lib/format'

export function VillageScene({ chapter, selectedCategory, categoryAmount, workspace, flow, hasData }: {
  chapter: StoryChapter; selectedCategory: string; workspace: boolean
  categoryAmount?: number
  flow?: { income: number; expense: number }; hasData: boolean
}) {
  const media = villageMedia()
  const video = useRef<HTMLVideoElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 })
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(!document.hidden)
  const [hovered, setHovered] = useState<Building | null>(null)
  const [focused, setFocused] = useState<Building | null>(null)

  useEffect(() => {
    const clearInteraction = () => { setHovered(null); setFocused(null) }
    const onVisible = () => { setVisible(!document.hidden); if (document.hidden) clearInteraction() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('blur', clearInteraction)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('blur', clearInteraction)
    }
  }, [])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const resize = () => {
      setHovered(null)
      const { width, height } = element.getBoundingClientRect()
      const scale = Math.max(width / 1920, height / 1080)
      setFit({ scale, x: (width - 1920 * scale) / 2, y: (height - 1080 * scale) / 2 })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => { setHovered(null); setFocused(null) }, [location.pathname, workspace])

  const playing = visible && !failed
  useEffect(() => {
    if (playing) void video.current?.play().catch(() => setFailed(true))
    else video.current?.pause()
  }, [playing])

  const highlighted = hovered ?? focused
  const active = highlighted
  const compactScene = window.matchMedia('(max-width: 1100px), (max-width: 1400px) and (max-height: 700px)').matches
  const showIncome = hasData && chapter === 'summary' && !!flow && flow.income > 0
  const showExpense = hasData && chapter === 'spending' && !!flow && flow.expense > 0

  return <div ref={host} className={`village-scene ${workspace ? 'is-working' : ''} ${playing ? 'is-playing' : ''}`} data-testid="village-scene">
      <img className="village-poster" src={media.poster} alt="富贵村：议事厅、账房、钱庄与集市"/>
      <video ref={video} className="village-video" autoPlay={playing} muted playsInline loop preload="metadata" poster={media.poster} onError={() => setFailed(true)} aria-hidden="true">
        <source src={media.video} type="video/mp4"/>
      </video>
      <div className="village-light"/>
      <div className="village-spatial-layer" hidden={workspace} onPointerLeave={() => setHovered(null)}>
        <div className="village-coordinates" style={{ width: 1920, height: 1080, transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
          {buildings.map(building => {
            const polygon = building.outline.split(' ').map(point => {
              const [x, y] = point.split(',').map(Number)
              return `${x / 1920 * 100}% ${y / 1080 * 100}%`
            }).join(',')
            return <Link key={building.id} to={building.href} className="building-hotspot"
              style={{ clipPath: `polygon(${polygon})` }} tabIndex={-1} aria-label={`进入${building.name}`}
              onPointerEnter={() => setHovered(building.id)} onPointerLeave={() => setHovered(null)} onPointerCancel={() => setHovered(null)}/>
          })}
        </div>
        {buildings.map(building => <BuildingLabel key={building.id} building={building} active={active === building.id}
          x={`clamp(var(--building-label-x-pad, ${compactScene ? 85 : 170}px), ${building.x * 1920 * fit.scale + fit.x}px, calc(100% - var(--building-label-x-pad, ${compactScene ? 85 : 170}px)))`}
          y={`clamp(var(--building-label-y-top, ${compactScene ? 55 : 160}px), ${building.y * 1080 * fit.scale + fit.y}px, calc(100% - var(--building-label-y-bottom, ${compactScene ? 55 : 85}px)))`}
          onHover={() => setHovered(building.id)} onLeave={() => setHovered(null)}
          onFocus={() => setFocused(building.id)} onBlur={() => setFocused(null)}/>)}
        {(showIncome || showExpense) && <div className={`scene-financial-focus ${showIncome ? 'is-income' : 'is-expense'}`} role="status">
          <div>
            <span>{showIncome ? '账房 · 本月收入' : `集市 · ${selectedCategory || '本月消费'}`}</span>
            <strong>{showIncome ? money(flow!.income) : money(categoryAmount ?? flow!.expense)}</strong>
            <small>{showIncome ? '本月收入记录' : categoryAmount === undefined ? '本月净支出' : '该类净支出'}</small>
          </div>
        </div>}
      </div>
    </div>
}
