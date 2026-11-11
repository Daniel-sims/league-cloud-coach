import { afterEach, expect, it, vi } from 'vitest'
import { captureTabFrame, encodeCapture, paintStrokes, type Stroke } from './drawing'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('reduces JPEG quality until the capture fits the byte limit, and refuses oversized output', () => {
  const canvas = {
    toDataURL: vi
      .fn()
      .mockReturnValueOnce('x'.repeat(400000))
      .mockReturnValue('data:image/jpeg;base64,/9j//9k='),
  } as unknown as HTMLCanvasElement
  expect(encodeCapture(canvas)).toBe('data:image/jpeg;base64,/9j//9k=')
  expect(canvas.toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.7)
  vi.mocked(canvas.toDataURL).mockReturnValue('x'.repeat(400000))
  expect(() => encodeCapture(canvas)).toThrow('too large')
})

it('scales coordinates to the image and erases only the ink layer', () => {
  const context = {
    canvas: { width: 1000, height: 500 },
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D
  const strokes: Stroke[] = [
    {
      tool: 'pen',
      color: '#ff0000',
      width: 0.01,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.9 },
      ],
    },
  ]
  paintStrokes(context, strokes)
  expect(context.moveTo).toHaveBeenCalledWith(200, 150)
  expect(context.lineTo).toHaveBeenCalledWith(800, 450)
  expect(context.lineWidth).toBe(10)
  paintStrokes(context, [{ ...strokes[0], opacity: 0.5 }])
  expect(context.globalAlpha).toBe(0.5)
  paintStrokes(context, [{ ...strokes[0], tool: 'highlighter' }])
  expect(context.globalAlpha).toBe(0.35)
  paintStrokes(context, [{ ...strokes[0], tool: 'eraser', opacity: 0.5 }])
  expect(context.globalAlpha).toBe(1)
  expect(context.globalCompositeOperation).toBe('destination-out')
})

it('stops every capture track when the user chooses a screen instead of a tab', async () => {
  const stop = vi.fn()
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue({
        getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
        getTracks: () => [{ stop }],
      }),
    },
  })
  await expect(captureTabFrame(document.createElement('div'))).rejects.toThrow(
    'Choose this browser tab',
  )
  expect(stop).toHaveBeenCalledOnce()
})

it('reports unsupported tab capture and preserves browser cancellation without saving anything', async () => {
  vi.stubGlobal('navigator', { mediaDevices: {} })
  await expect(captureTabFrame(document.createElement('div'))).rejects.toThrow('unavailable')
  const denied = new DOMException('Permission denied', 'NotAllowedError')
  vi.stubGlobal('navigator', {
    mediaDevices: { getDisplayMedia: vi.fn().mockRejectedValue(denied) },
  })
  await expect(captureTabFrame(document.createElement('div'))).rejects.toBe(denied)
})
