import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DrawingCapture } from './DrawingCapture'

afterEach(cleanup)

function editor() {
  render(
    <DrawingCapture
      frame="data:image/jpeg;base64,/9j//9k="
      timeLabel="1:00"
      role="owner"
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  )
  fireEvent.load(screen.getByAltText('Frozen video frame'))
  return screen.getByLabelText('Draw on the frozen video frame')
}

const press = { pointerId: 1, button: 0, buttons: 1 }

it('keeps a line when Chrome drops pointer capture before the release', () => {
  const canvas = editor()
  fireEvent.pointerDown(canvas, press)
  fireEvent.gotPointerCapture(canvas, press)
  fireEvent.pointerMove(canvas, press)
  fireEvent.lostPointerCapture(canvas, press)
  fireEvent.pointerUp(canvas, { ...press, buttons: 0 })
  const undo = screen.getByRole('button', { name: 'Undo' })
  expect(undo).toBeEnabled()
  fireEvent.click(undo)
  expect(undo).toBeDisabled()
})

it('ignores the previous press losing capture after a quick new line starts', () => {
  const canvas = editor()
  fireEvent.pointerDown(canvas, press)
  fireEvent.gotPointerCapture(canvas, press)
  fireEvent.pointerUp(canvas, { ...press, buttons: 0 })
  fireEvent.pointerDown(canvas, press)
  // The first press's capture loss arrives late; the second line must survive it.
  fireEvent.lostPointerCapture(canvas, press)
  fireEvent.gotPointerCapture(canvas, press)
  fireEvent.pointerMove(canvas, press)
  fireEvent.pointerUp(canvas, { ...press, buttons: 0 })
  const undo = screen.getByRole('button', { name: 'Undo' })
  fireEvent.click(undo)
  expect(undo).toBeEnabled()
  fireEvent.click(undo)
  expect(undo).toBeDisabled()
})

it('discards a line the browser cancels', () => {
  const canvas = editor()
  fireEvent.pointerDown(canvas, press)
  fireEvent.pointerCancel(canvas, press)
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
})
