import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'

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

/**
 * Arrow-key seeking that doesn't depend on focus being inside the player: a
 * page-level listener, so it works as soon as the page is open. Keys already
 * claimed (the player's own capture handler, a dialog, a field) are left alone.
 */
export function useSeekKeys(seek: (delta: number) => boolean, togglePlay?: () => void) {
  const latest = useRef({ seek, togglePlay })
  latest.current = { seek, togglePlay }
  useEffect(() => {
    let swallowSpaceUp = false
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          'input, textarea, select, [contenteditable], [role="textbox"], dialog[open]',
        ))
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.isComposing) return
      if (typing(event.target)) return
      if (event.key === ' ' && !event.ctrlKey && !event.shiftKey) {
        if (!latest.current.togglePlay) return
        latest.current.togglePlay()
        // A focused button would otherwise also click on key-up.
        swallowSpaceUp = true
        event.preventDefault()
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.target instanceof HTMLElement && event.target.closest('[role="slider"]')) return
      if (!latest.current.seek((event.key === 'ArrowLeft' ? -1 : 1) * jumpSeconds(event))) return
      event.preventDefault()
    }
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key !== ' ' || !swallowSpaceUp) return
      swallowSpaceUp = false
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
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
