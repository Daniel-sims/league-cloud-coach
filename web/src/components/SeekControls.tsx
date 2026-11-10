import type { KeyboardEvent } from 'react'

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

const steps = [-30, -15, -1, 1, 15, 30]

export function SeekControls({
  seek,
  disabled,
}: {
  seek: (delta: number) => boolean
  disabled: boolean
}) {
  return (
    <div className="seek-controls" role="group" aria-label="Video seek controls">
      {steps.map((step) => {
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
      })}
    </div>
  )
}
