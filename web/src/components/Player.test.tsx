import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Player } from './Player'

afterEach(() => {
  cleanup()
  delete window.YT
})
it('uses the same jumps for YouTube controls, bounds seeks, and cleans up the player', async () => {
  let position = 60
  const seekTo = vi.fn((seconds: number) => {
    position = seconds
  })
  const destroy = vi.fn()
  window.YT = {
    Player: class {
      constructor(_element: HTMLElement, options: Record<string, unknown>) {
        queueMicrotask(() => (options.events as { onReady: () => void }).onReady())
      }
      destroy = destroy
      getCurrentTime = () => position
      getDuration = () => 120
      seekTo = seekTo
    },
  }
  const view = render(<Player videoId="aqz-KE-bpKQ" title="Test game" />)
  await act(async () => {})
  const forward = screen.getByRole('button', { name: 'Forward 1 second' })
  fireEvent.keyDown(forward, { key: 'ArrowRight' })
  expect(seekTo).toHaveBeenLastCalledWith(61, true)
  fireEvent.keyDown(forward, { key: 'ArrowLeft', shiftKey: true })
  expect(seekTo).toHaveBeenLastCalledWith(51, true)
  fireEvent.keyDown(forward, { key: 'ArrowRight', ctrlKey: true })
  expect(seekTo).toHaveBeenLastCalledWith(81, true)
  position = 2
  fireEvent.keyDown(forward, { key: 'ArrowLeft', ctrlKey: true })
  expect(seekTo).toHaveBeenLastCalledWith(0, true)
  position = 119
  fireEvent.keyDown(forward, { key: 'ArrowRight', shiftKey: true })
  expect(seekTo).toHaveBeenLastCalledWith(120, true)
  view.unmount()
  expect(destroy).toHaveBeenCalledOnce()
})
