import { useEffect, useRef, useState, type PointerEvent } from 'react'

export type AiBubblePosition = { x: number; y: number }
const storageKey = 'spendwise-ai-launcher-position-v2'
type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean }

function metrics() {
  return window.innerWidth <= 600 ? { size: 44, margin: 12 } : { size: 60, margin: 20 }
}

function clamp(position: AiBubblePosition): AiBubblePosition {
  const { size, margin } = metrics()
  return {
    x: Math.max(margin, Math.min(position.x, window.innerWidth - size - margin)),
    y: Math.max(margin, Math.min(position.y, window.innerHeight - size - margin)),
  }
}

function initialPosition(): AiBubblePosition {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null') as AiBubblePosition | null
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return clamp(stored)
  } catch { /* Ignore an invalid saved position. */ }
  const { size, margin } = metrics()
  return clamp({ x: margin, y: window.innerHeight - size - margin })
}

export function AiLauncher({ onOpen }: { onOpen: (position: AiBubblePosition) => void }) {
  const [position, setPosition] = useState(initialPosition)
  const positionRef = useRef(position)
  const dragRef = useRef<Drag | null>(null)

  function move(value: AiBubblePosition) {
    const next = clamp(value)
    positionRef.current = next
    setPosition(next)
  }

  useEffect(() => {
    const onResize = () => move(positionRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ...positionRef.current, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.hypot(dx, dy) > 6) drag.moved = true
    if (drag.moved) move({ x: drag.x + dx, y: drag.y + dy })
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.moved) localStorage.setItem(storageKey, JSON.stringify(positionRef.current))
    else onOpen(positionRef.current)
  }

  return <button
    type="button"
    className="ai-launcher"
    style={{ left: position.x, top: position.y }}
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerUp}
    onPointerCancel={() => { dragRef.current = null }}
    onClick={event => { if (event.detail === 0) onOpen(positionRef.current) }}
    aria-label="打开 AI 助手"
    title="打开 AI 助手，可拖动位置"
    data-testid="ai-bubble"
  >
    <svg aria-hidden="true" width="34" height="34" viewBox="0 0 40 40" fill="none">
      <path d="M11.3 27.8C7.2 27.8 4.2 25.1 4.2 21.6c0-3.1 2.3-5.6 5.5-6.1 1.4-4.6 5.4-7.4 10.3-7.4 4.6 0 8.5 2.7 10.1 6.8 3.5.2 5.7 2.7 5.7 6.1 0 3.6-2.9 6.4-6.7 6.4H18.5l-6.5 4.3.9-4.3h-1.6Z" fill="currentColor"/>
      <circle cx="14.5" cy="20.5" r="1.6" fill="var(--accent)"/>
      <circle cx="20" cy="20.5" r="1.6" fill="var(--accent)"/>
      <circle cx="25.5" cy="20.5" r="1.6" fill="var(--accent)"/>
    </svg>
  </button>
}
