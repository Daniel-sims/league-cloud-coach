export type Point = { x: number; y: number }
export type DrawingTool = 'pen' | 'highlighter' | 'arrow' | 'text' | 'eraser'
export type TextStyle = 'outline' | 'box' | 'plain'
export type Stroke = {
  tool: DrawingTool
  color: string
  width: number
  opacity?: number
  points: Point[]
  /** Text strokes: the first point is the top-left corner of the text block. */
  text?: string
  /** Text strokes: the font size as a fraction of the image width. */
  fontSize?: number
  textStyle?: TextStyle
}
export const captureByteLimit = 256 * 1024
export const textLineHeight = 1.25
export const textFontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const textFont = (px: number) => `700 ${px}px ${textFontFamily}`

/** Black or white, whichever stands out against the given #rrggbb ink. */
export function contrastFor(color: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return '#000000'
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4 ? '#ffffff' : '#000000'
}

/** A text stroke's lines and box, in canvas pixels. */
export function textLayout(context: CanvasRenderingContext2D, stroke: Stroke, placeholder = '') {
  const { width, height } = context.canvas
  const size = (stroke.fontSize ?? 0.025) * width
  const line = size * textLineHeight
  const lines = (stroke.text || placeholder).split('\n')
  context.save()
  context.font = textFont(size)
  const textWidth = Math.max(0, ...lines.map((text) => context.measureText(text).width))
  context.restore()
  const origin = stroke.points[0] ?? { x: 0, y: 0 }
  return {
    x: origin.x * width,
    y: origin.y * height,
    size,
    line,
    lines,
    width: textWidth,
    height: lines.length * line,
    pad: size * 0.3,
  }
}

/** The topmost text stroke under a point (image fractions), or -1. */
export function textAt(context: CanvasRenderingContext2D, strokes: Stroke[], point: Point) {
  const { width, height } = context.canvas
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index]
    if (stroke.tool !== 'text' || !stroke.text) continue
    const box = textLayout(context, stroke)
    const x = point.x * width
    const y = point.y * height
    if (
      x >= box.x - box.pad &&
      x <= box.x + box.width + box.pad &&
      y >= box.y - box.pad &&
      y <= box.y + box.height + box.pad
    )
      return index
  }
  return -1
}

function paintText(context: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.text?.trim()) return
  const box = textLayout(context, stroke)
  const backdrop = contrastFor(stroke.color)
  context.font = textFont(box.size)
  context.textBaseline = 'middle'
  context.textAlign = 'left'
  if (stroke.textStyle === 'box') {
    context.save()
    context.globalAlpha *= backdrop === '#000000' ? 0.6 : 0.8
    context.fillStyle = backdrop
    context.beginPath()
    const rect = [
      box.x - box.pad,
      box.y - box.pad * 0.5,
      box.width + box.pad * 2,
      box.height + box.pad,
    ] as const
    if (typeof context.roundRect === 'function') context.roundRect(...rect, box.pad * 0.6)
    else context.rect(...rect)
    context.fill()
    context.restore()
  }
  const baseline = (index: number) => box.y + index * box.line + box.line / 2
  if (stroke.textStyle !== 'box' && stroke.textStyle !== 'plain') {
    // Stroke every line before filling any, so outlines never cover letters.
    context.strokeStyle = backdrop
    context.lineWidth = box.size * 0.18
    context.lineJoin = 'round'
    box.lines.forEach((text, index) => context.strokeText(text, box.x, baseline(index)))
  }
  context.fillStyle = stroke.color
  box.lines.forEach((text, index) => context.fillText(text, box.x, baseline(index)))
}

/** Coordinates and widths use fractions of the image, independent of display size. */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[]) {
  const { width, height } = context.canvas
  context.clearRect(0, 0, width, height)
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    context.save()
    if (stroke.tool === 'text') {
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = stroke.opacity ?? 1
      paintText(context, stroke)
      context.restore()
      continue
    }
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
