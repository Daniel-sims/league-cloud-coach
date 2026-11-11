export type Point = { x: number; y: number }
export type DrawingTool = 'pen' | 'highlighter' | 'arrow' | 'eraser'
export type Stroke = {
  tool: DrawingTool
  color: string
  width: number
  opacity?: number
  points: Point[]
}
export const captureByteLimit = 256 * 1024

/** Coordinates and widths use fractions of the image, independent of display size. */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[]) {
  const { width, height } = context.canvas
  context.clearRect(0, 0, width, height)
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    context.save()
    context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    context.globalAlpha =
      stroke.tool === 'eraser' ? 1 : (stroke.opacity ?? (stroke.tool === 'highlighter' ? 0.35 : 1))
    context.strokeStyle = stroke.color
    context.fillStyle = stroke.color
    context.lineWidth = stroke.width * width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const first = stroke.points[0]
    const last = stroke.points.at(-1)!
    context.beginPath()
    context.moveTo(first.x * width, first.y * height)
    const points = stroke.tool === 'arrow' ? [last] : stroke.points
    for (const point of points) context.lineTo(point.x * width, point.y * height)
    // A click should leave a dot as well as a drag leaving a line.
    if (stroke.points.length === 1) context.lineTo(first.x * width + 0.01, first.y * height)
    context.stroke()
    if (stroke.tool === 'arrow') {
      const angle = Math.atan2((last.y - first.y) * height, (last.x - first.x) * width)
      const length = Math.max(context.lineWidth * 4, width * 0.015)
      context.beginPath()
      context.moveTo(last.x * width, last.y * height)
      context.lineTo(
        last.x * width - length * Math.cos(angle - Math.PI / 6),
        last.y * height - length * Math.sin(angle - Math.PI / 6),
      )
      context.lineTo(
        last.x * width - length * Math.cos(angle + Math.PI / 6),
        last.y * height - length * Math.sin(angle + Math.PI / 6),
      )
      context.closePath()
      context.fill()
    }
    context.restore()
  }
}

export function canvasFor(
  source: HTMLVideoElement | HTMLImageElement,
  width: number,
  height: number,
) {
  if (!width || !height)
    throw new Error('No video frame is available yet. Wait for the video to load.')
  const scale = Math.min(1, 1280 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Drawing is unavailable in this browser.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function encodeCapture(canvas: HTMLCanvasElement): string {
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const image = canvas.toDataURL('image/jpeg', quality)
    if (image.length <= Math.floor(captureByteLimit / 3) * 4) return image
  }
  throw new Error('This image is too large to save. Try a smaller capture.')
}

/** YouTube's iframe has no frame API. The browser asks the user to choose this tab. */
export async function captureTabFrame(stage: HTMLElement): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw new Error(
      'Tab capture is unavailable. Use a desktop browser that supports screen sharing.',
    )
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  } as DisplayMediaStreamOptions)
  const video = document.createElement('video')
  try {
    const track = stream.getVideoTracks()[0]
    if (track.getSettings().displaySurface !== 'browser')
      throw new Error(
        'Choose this browser tab, rather than a screen or window, to capture the video.',
      )
    video.srcObject = stream
    video.muted = true
    // Wait for an actual decoded frame, not just metadata.
    if (typeof video.requestVideoFrameCallback !== 'function')
      throw new Error('Tab capture is unavailable in this browser. Try current desktop Chrome.')
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The tab did not provide a frame. Try again.')),
        8000,
      )
      video.requestVideoFrameCallback(() => {
        clearTimeout(timeout)
        resolve()
      })
      void video.play().catch((reason) => {
        clearTimeout(timeout)
        reject(reason)
      })
    })
    const rect = stage.getBoundingClientRect()
    if (
      rect.top < 0 ||
      rect.left < 0 ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom > window.innerHeight ||
      rect.right > window.innerWidth
    )
      throw new Error('Keep the full video visible in this tab, then try Draw again.')
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1280 / Math.max(rect.width, rect.height))
    canvas.width = Math.round(rect.width * scale)
    canvas.height = Math.round(rect.height * scale)
    const context = canvas.getContext('2d')!
    const x = video.videoWidth / window.innerWidth
    const y = video.videoHeight / window.innerHeight
    context.drawImage(
      video,
      rect.left * x,
      rect.top * y,
      rect.width * x,
      rect.height * y,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return encodeCapture(canvas)
  } finally {
    stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }
}
