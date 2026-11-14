import { Pause, Play } from 'lucide-react'
import { useEffect, useRef } from 'react'

type Modifiers = { ctrlKey: boolean; shiftKey: boolean }
export const jumpSeconds = ({ ctrlKey, shiftKey }: Modifiers) => (ctrlKey ? 30 : shiftKey ? 10 : 1)
export const seekPosition = (position: number, delta: number, duration: number) =>
  Math.max(0, Math.min(duration, position + delta))

// Typing targets keep every key.
const editing = 'input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]'
// Widgets that use the arrow keys themselves.
const arrowWidgets =
  '[role="slider"], [role="separator"], [role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], [role="radiogroup"], [role="tree"], [role="grid"]'

/** What a keydown means for the player, or null when it belongs to someone else. */
export function playerKey(event: KeyboardEvent): 'toggle' | 'faster' | 'slower' | number | null {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.isComposing) return null
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest(editing) || (target instanceof HTMLElement && target.isContentEditable))
    return null
  // A modal (drawing editor, confirmations) owns the keyboard while open.
  if (document.querySelector('dialog[open]')) return null
  // - and + (= is + without Shift) change speed. Ctrl with them is browser
  // zoom, and a focused slider (the scrubber zooms with them) keeps them.
  const speed = { '-': 'slower', _: 'slower', '+': 'faster', '=': 'faster' } as const
  if (event.key in speed) {
    if (event.ctrlKey || target?.closest(arrowWidgets)) return null
    return speed[event.key as keyof typeof speed]
  }
  if (event.key === ' ') {
    if (event.ctrlKey || event.shiftKey || target?.closest('[role="menu"]')) return null
    return 'toggle'
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return null
  if (target?.closest(arrowWidgets)) return null
  return (event.key === 'ArrowLeft' ? -1 : 1) * jumpSeconds(event)
}

/**
 * Page-wide playback keys: Space plays/pauses, arrows seek 1s (Shift 10s,
 * Ctrl 30s), - and + step the playback speed down and up. Listens on window in the capture phase and claims the key, so
 * the browser's own video controls never also act on it. Without that, a
 * focused <video> toggled play twice per Space and its scrubber seeked by 1%
 * of the duration (18–30s on a game) per arrow press.
 */
export function useSeekKeys(
  seek: (delta: number) => boolean,
  togglePlay?: () => void,
  /** Steps the speed one menu entry; false when the player can't yet. */
  changeSpeed?: (direction: 1 | -1) => boolean,
) {
  const latest = useRef({ seek, togglePlay, changeSpeed })
  latest.current = { seek, togglePlay, changeSpeed }
  useEffect(() => {
    let claimedSpace = false
    const claim = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onKey = (event: KeyboardEvent) => {
      const action = playerKey(event)
      if (action === null) return
      if (action === 'toggle') {
        if (!latest.current.togglePlay) return
        // Holding Space repeats keydown; toggling on each would flicker.
        if (!event.repeat) latest.current.togglePlay()
        claimedSpace = true
        claim(event)
        return
      }
      if (action === 'faster' || action === 'slower') {
        if (latest.current.changeSpeed?.(action === 'faster' ? 1 : -1)) claim(event)
        return
      }
      if (latest.current.seek(action)) claim(event)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      // A focused button would otherwise click on Space's key-up.
      if (event.key !== ' ' || !claimedSpace) return
      claimedSpace = false
      claim(event)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [])
}

const steps = [-30, -15, -1, 1, 15, 30]

export function SeekControls({
  seek,
  disabled,
  playing,
  onTogglePlay,
}: {
  seek: (delta: number) => boolean
  disabled: boolean
  playing?: boolean
  onTogglePlay?: () => void
}) {
  const button = (step: number) => {
    const seconds = Math.abs(step)
    return (
      <button
        key={step}
        className="button secondary button-small"
        disabled={disabled}
        onClick={() => seek(step)}
        aria-label={`${step < 0 ? 'Back' : 'Forward'} ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
      >
        {step < 0 ? '−' : '+'}
        {seconds}s
      </button>
    )
  }
  return (
    <div className="seek-controls" role="group" aria-label="Video seek controls">
      {steps.filter((step) => step < 0).map(button)}
      {onTogglePlay && (
        <button
          className="button button-small seek-play"
          disabled={disabled}
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
      )}
      {steps.filter((step) => step > 0).map(button)}
    </div>
  )
}
