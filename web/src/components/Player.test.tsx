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
  const playVideo = vi.fn()
  const pauseVideo = vi.fn()
  const setPlaybackRate = vi.fn()
  let events: { onStateChange: (event: { data: number }) => void } | undefined
  window.YT = {
    Player: class {
      constructor(_element: HTMLElement, options: Record<string, unknown>) {
        events = options.events as typeof events
        queueMicrotask(() => (options.events as { onReady: () => void }).onReady())
      }
      destroy = destroy
      playVideo = playVideo
      pauseVideo = pauseVideo
      getCurrentTime = () => position
      getDuration = () => 120
      seekTo = seekTo
      getPlayerState = () => 2
      getVideoLoadedFraction = () => 0.5
      getPlaybackRate = () => 1
      setPlaybackRate = setPlaybackRate
      getVolume = () => 100
      setVolume = vi.fn()
      isMuted = () => false
      mute = vi.fn()
      unMute = vi.fn()
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
  fireEvent.keyDown(forward, { key: '+', shiftKey: true })
  expect(setPlaybackRate).toHaveBeenLastCalledWith(1.25)
  fireEvent.keyDown(forward, { key: '-' })
  expect(setPlaybackRate).toHaveBeenLastCalledWith(0.75)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(playVideo).toHaveBeenCalledOnce()
  await act(async () => events!.onStateChange({ data: 1 }))
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(pauseVideo).toHaveBeenCalledOnce()
  view.unmount()
  expect(destroy).toHaveBeenCalledOnce()
})
