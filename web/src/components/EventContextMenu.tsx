import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus } from 'lucide-react'

export type EventMenuTarget = { x: number; y: number; origin: HTMLElement | null }

export function EventContextMenu({
  target,
  label,
  disabled,
  hint,
  onComment,
  onClose,
}: {
  target: EventMenuTarget
  label: string
  disabled: boolean
  hint?: string
  onComment(): void
  onClose(): void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: target.x, y: target.y })
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (box)
      setPosition({
        x: Math.max(8, Math.min(target.x, innerWidth - box.width - 8)),
        y: Math.max(8, Math.min(target.y, innerHeight - box.height - 8)),
      })
    const item = menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    ;(item ?? menu.current)?.focus({ preventScroll: true })
  }, [target])
  useEffect(() => {
    const dismiss = () => onClose()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault()
        event.stopPropagation()
        onClose()
        target.origin?.focus({ preventScroll: true })
      } else if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault()
        menu.current
          ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          ?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    document.addEventListener('wheel', dismiss, true)
    document.addEventListener('touchmove', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
      document.removeEventListener('wheel', dismiss, true)
      document.removeEventListener('touchmove', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [target, onClose])
  return createPortal(
    <div
      ref={menu}
      className="event-context-menu"
      role="menu"
      aria-label="Event actions"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
    >
      <small title={label}>{label}</small>
      <button
        role="menuitem"
        disabled={disabled}
        title={
          disabled
            ? (hint ?? 'Event comments need a synced recording covering this moment')
            : undefined
        }
        onClick={() => {
          onClose()
          onComment()
        }}
      >
        <MessageSquarePlus size={14} />
        Add comment
      </button>
    </div>,
    document.body,
  )
}
