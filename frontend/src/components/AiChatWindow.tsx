import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, Grip } from 'lucide-react'
import type { AiBubblePosition } from './AiLauncher'
import { AiChat } from '../pages/AiChat'
import type { AssistantContext, AssistantDraft } from './village/VillageContext'
import { JourneyTipCard } from './village/VillageJourney'

const bubbleSize = 60
const margin = 16
const sizeKey = 'spendwise-ai-window-size-v1'
const positionKey = 'spendwise-ai-window-position-v1'
type Size = { width: number; height: number }
type Position = { x: number; y: number }
type Anchor = { horizontal: 'left' | 'right'; vertical: 'top' | 'bottom' }
type Axis = 'horizontal' | 'vertical' | 'corner'
type Resize = { pointerId: number; x: number; y: number; width: number; height: number; axis: Axis; moved: boolean }
type Drag = { pointerId: number; x: number; y: number; left: number; top: number; moved: boolean }

function initialSize(): Size {
  try {
    const saved = JSON.parse(localStorage.getItem(sizeKey) || 'null') as Size | null
    if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved
  } catch { /* Fall back to viewport size. */ }
  return { width: Math.round(window.innerWidth * .34), height: Math.round(window.innerHeight * .82) }
}

function clampSize(value: Size, viewport: Size): Size {
  const availableWidth = Math.max(1, viewport.width - margin * 2)
  const availableHeight = Math.max(1, viewport.height - margin * 2)
  return {
    width: Math.max(Math.min(380, availableWidth), Math.min(value.width, availableWidth)),
    height: Math.max(Math.min(440, availableHeight), Math.min(value.height, availableHeight)),
  }
}

function clampPosition(value: Position, size: Size, viewport: Size): Position {
  return {
    x: Math.max(margin, Math.min(value.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(value.y, viewport.height - size.height - margin)),
  }
}

function initialPosition(bubble: AiBubblePosition, size: Size): Position {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const boundedSize = clampSize(size, viewport)
  try {
    const saved = JSON.parse(localStorage.getItem(positionKey) || 'null') as Position | null
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampPosition(saved, boundedSize, viewport)
  } catch { /* Ignore an invalid saved position. */ }
  const onRight = bubble.x + bubbleSize / 2 > viewport.width / 2
  const onBottom = bubble.y + bubbleSize / 2 > viewport.height / 2
  return clampPosition({
    x: onRight ? bubble.x + bubbleSize - boundedSize.width : bubble.x,
    y: onBottom ? bubble.y + bubbleSize - boundedSize.height : bubble.y,
  }, boundedSize, viewport)
}

function anchorFor(position: Position, size: Size, viewport: Size): Anchor {
  return {
    horizontal: position.x + size.width / 2 < viewport.width / 2 ? 'left' : 'right',
    vertical: position.y + size.height / 2 < viewport.height / 2 ? 'top' : 'bottom',
  }
}

export function AiChatWindow({ open, onCollapse, bubblePosition, initialConversationId, villageContext, onClearContext, suggestedDraft }: {
  open: boolean
  onCollapse: () => void
  bubblePosition: AiBubblePosition
  initialConversationId?: string | null
  villageContext?: AssistantContext | null
  onClearContext?: () => void
  suggestedDraft?: AssistantDraft
}) {
  const [size, setSize] = useState(() => clampSize(initialSize(), { width: window.innerWidth, height: window.innerHeight }))
  const sizeRef = useRef(size)
  const resizeRef = useRef<Resize | null>(null)
  const [position, setPosition] = useState(() => initialPosition(bubblePosition, size))
  const positionRef = useRef(position)
  const dragRef = useRef<Drag | null>(null)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [anchor, setAnchor] = useState(() => anchorFor(position, size, viewport))

  useEffect(() => {
    const onResize = () => {
      const view = { width: window.innerWidth, height: window.innerHeight }
      const nextSize = clampSize(sizeRef.current, view)
      const nextPosition = clampPosition(positionRef.current, nextSize, view)
      sizeRef.current = nextSize
      positionRef.current = nextPosition
      setSize(nextSize)
      setPosition(nextPosition)
      setViewport(view)
      setAnchor(anchorFor(nextPosition, nextSize, view))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { horizontal, vertical } = anchor
  const boundedSize = clampSize(size, viewport)
  const width = boundedSize.width
  const height = boundedSize.height
  const boundedPosition = clampPosition(position, boundedSize, viewport)
  const left = boundedPosition.x
  const top = boundedPosition.y
  const minimumWidth = Math.min(380, Math.max(1, viewport.width - margin * 2))
  const minimumHeight = Math.min(440, Math.max(1, viewport.height - margin * 2))
  const maxWidth = horizontal === 'left' ? viewport.width - left - margin : left + width - margin
  const maxHeight = vertical === 'top' ? viewport.height - top - margin : top + height - margin
  const style: CSSProperties = {
    left, top, width, height,
    transformOrigin: `${horizontal} ${vertical}`,
  }

  function updatePosition(next: Position) {
    const value = clampPosition(next, sizeRef.current, viewport)
    positionRef.current = value
    setPosition(value)
  }

  function updateSize(next: Size) {
    const value = {
      width: Math.max(minimumWidth, Math.min(next.width, maxWidth)),
      height: Math.max(minimumHeight, Math.min(next.height, maxHeight)),
    }
    const nextPosition = clampPosition({
      x: horizontal === 'left' ? left : left + width - value.width,
      y: vertical === 'top' ? top : top + height - value.height,
    }, value, viewport)
    sizeRef.current = value
    positionRef.current = nextPosition
    setSize(value)
    setPosition(nextPosition)
  }

  function dragStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: positionRef.current.x, top: positionRef.current.y, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function dragMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (Math.hypot(dx, dy) > 3) drag.moved = true
    if (drag.moved) updatePosition({ x: drag.left + dx, y: drag.top + dy })
  }

  function dragEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.moved) {
      localStorage.setItem(positionKey, JSON.stringify(positionRef.current))
      setAnchor(anchorFor(positionRef.current, sizeRef.current, viewport))
    }
  }

  function dragKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 16
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
    if (!dx && !dy) return
    event.preventDefault()
    updatePosition({ x: positionRef.current.x + dx, y: positionRef.current.y + dy })
    localStorage.setItem(positionKey, JSON.stringify(positionRef.current))
    setAnchor(anchorFor(positionRef.current, sizeRef.current, viewport))
  }

  function resizeStart(event: PointerEvent<HTMLDivElement>, axis: Axis) {
    if (event.button !== 0) return
    resizeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width, height, axis, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resizeMove(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const dx = event.clientX - resize.x
    const dy = event.clientY - resize.y
    if (Math.hypot(dx, dy) < 3 && !resize.moved) return
    resize.moved = true
    updateSize({
      width: resize.axis === 'vertical' ? resize.width : resize.width + (horizontal === 'left' ? dx : -dx),
      height: resize.axis === 'horizontal' ? resize.height : resize.height + (vertical === 'top' ? dy : -dy),
    })
  }

  function resizeEnd(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (resize.moved) {
      localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current))
      localStorage.setItem(positionKey, JSON.stringify(positionRef.current))
      setAnchor(anchorFor(positionRef.current, sizeRef.current, viewport))
    }
  }

  function resizeKey(event: KeyboardEvent<HTMLDivElement>, axis: Axis) {
    const delta = event.shiftKey ? 40 : 16
    const dx = event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0
    const dy = event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0
    if ((axis !== 'vertical' && dx) || (axis !== 'horizontal' && dy)) {
      event.preventDefault()
      updateSize({ width: width + (horizontal === 'left' ? dx : -dx), height: height + (vertical === 'top' ? dy : -dy) })
      localStorage.setItem(sizeKey, JSON.stringify(sizeRef.current))
      localStorage.setItem(positionKey, JSON.stringify(positionRef.current))
      setAnchor(anchorFor(positionRef.current, sizeRef.current, viewport))
    }
  }

  return <section className={`ai-window village-floating-assistant ${open ? 'is-open' : 'is-collapsed'}`} style={style} role="dialog" aria-label="富贵村财务管理助手" aria-hidden={!open} hidden={!open} data-testid="ai-chat-window">
    <div className="ai-window-head">
      <div className="ai-window-drag-handle" role="button" tabIndex={open ? 0 : -1} aria-label="拖动 AI 助手窗口" data-testid="ai-panel-drag-handle" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={() => { dragRef.current = null }} onKeyDown={dragKey}><Grip size={15} aria-hidden="true"/><span>富贵村财务助手</span></div>
      <button type="button" className="ai-collapse-button" onClick={onCollapse} aria-label="收起 AI 助手" data-testid="ai-panel-collapse"><ChevronDown size={18}/>收起</button>
    </div>
    {open && <JourneyTipCard kind="assistant"/>}
    <AiChat mode="panel" initialConversationId={initialConversationId} villageContext={villageContext} onClearContext={onClearContext} suggestedDraft={suggestedDraft}/>
    <div className={`ai-resize-edge ai-resize-horizontal ${horizontal === 'left' ? 'at-right' : 'at-left'}`} role="separator" aria-label="调整对话框宽度" aria-orientation="vertical" tabIndex={open ? 0 : -1} data-testid="ai-panel-resize-horizontal" onPointerDown={event => resizeStart(event, 'horizontal')} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={() => { resizeRef.current = null }} onKeyDown={event => resizeKey(event, 'horizontal')}/>
    <div className={`ai-resize-edge ai-resize-vertical ${vertical === 'top' ? 'at-bottom' : 'at-top'}`} role="separator" aria-label="调整对话框高度" aria-orientation="horizontal" tabIndex={open ? 0 : -1} data-testid="ai-panel-resize-vertical" onPointerDown={event => resizeStart(event, 'vertical')} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={() => { resizeRef.current = null }} onKeyDown={event => resizeKey(event, 'vertical')}/>
    <div className={`ai-resize-corner ${horizontal === 'left' ? 'at-right' : 'at-left'} ${vertical === 'top' ? 'at-bottom' : 'at-top'}`} role="separator" aria-label="调整对话框宽度和高度" tabIndex={open ? 0 : -1} data-testid="ai-panel-resize-handle" onPointerDown={event => resizeStart(event, 'corner')} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={() => { resizeRef.current = null }} onKeyDown={event => resizeKey(event, 'corner')}/>
  </section>
}
