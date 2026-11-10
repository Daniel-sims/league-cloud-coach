import type { KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Modifiers = { ctrlKey: boolean; shiftKey: boolean }
export const jumpSeconds = ({ ctrlKey, shiftKey }: Modifiers) => (ctrlKey ? 30 : shiftKey ? 10 : 1)
export const seekPosition = (position: number, delta: number, duration: number) =>
  Math.max(0, Math.min(duration, position + delta))

export function seekWithKeyboard(
  event: KeyboardEvent<HTMLElement>,
  seek: (delta: number) => boolean,
) {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.nativeEvent.isComposing)
    return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        'input, textarea, select, [contenteditable], [role="textbox"], [role="slider"]',
      ))
  )
    return
  if (!seek((event.key === 'ArrowLeft' ? -1 : 1) * jumpSeconds(event))) return
  event.preventDefault()
  event.stopPropagation()
}

export function SeekControls({
  seek,
  disabled,
}: {
  seek: (delta: number) => boolean
  disabled: boolean
}) {
  return (
    <div className="seek-controls" aria-label="Video seek controls">
      <button
        className="button secondary button-small"
        disabled={disabled}
        onClick={(event) => seek(-jumpSeconds(event))}
        aria-label="Back 1 second"
        title="Back 1 second · Shift: 10 seconds · Ctrl: 30 seconds"
      >
        <ChevronLeft size={16} />
        1s
      </button>
      <button
        className="button secondary button-small"
        disabled={disabled}
        onClick={(event) => seek(jumpSeconds(event))}
        aria-label="Forward 1 second"
        title="Forward 1 second · Shift: 10 seconds · Ctrl: 30 seconds"
      >
        1s
        <ChevronRight size={16} />
      </button>
      <span className="seek-hint">
        ← / → 1s <span>· Shift 10s · Ctrl 30s</span>
      </span>
    </div>
  )
}
