import { useEffect, useRef, useState, type PointerEvent, type Ref } from 'react'
import {
  ArrowUpRight,
  Camera,
  Eraser,
  Highlighter,
  Pencil,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import { Dialog } from './Dialog'
import {
  canvasFor,
  encodeCapture,
  paintStrokes,
  textAt,
  textFontFamily,
  textLayout,
  textLineHeight,
  type DrawingTool,
  type Point,
  type Stroke,
  type TextStyle,
} from '../lib/drawing'
import {
  saveCoachName,
  savedCoachName,
  type ReviewCapture,
  type ReviewRepository,
} from '../lib/review'

const colors = ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#ffffff', '#111827']
const colorNames = ['Red', 'Yellow', 'Green', 'Blue', 'White', 'Black']
const tools = [
  { id: 'pen', name: 'Pen', Icon: Pencil },
  { id: 'highlighter', name: 'Highlighter', Icon: Highlighter },
  { id: 'arrow', name: 'Arrow', Icon: ArrowUpRight },
  { id: 'text', name: 'Text', Icon: Type },
  { id: 'eraser', name: 'Eraser', Icon: Eraser },
] as const
/** Pixel sizes on a 1280-wide frame; stored as a fraction of the width. */
const textSizes = [
  { px: 20, name: 'Small' },
  { px: 32, name: 'Medium' },
  { px: 48, name: 'Large' },
  { px: 72, name: 'Huge' },
]
const textStyles: { id: TextStyle; name: string }[] = [
  { id: 'outline', name: 'Outline' },
  { id: 'box', name: 'Background' },
  { id: 'plain', name: 'Plain' },
]
const textPlaceholder = 'Type here'
/** Text being typed: a new block (index null) or a replacement for strokes[index]. */
type TextEdit = { index: number | null; stroke: Stroke; key: number }
type TextDrag = { index: number; start: Point; stroke: Stroke; moved: boolean }

export function DrawingCapture({
  frame,
  timeLabel,
  role,
  fixedName,
  onClose,
  onSave,
}: {
  frame: string
  timeLabel: string
  role: 'owner' | 'coach'
  /** A named guest's name is set by the owner, not typed. */
  fixedName?: string
  onClose(): void
  onSave(image: string, body: string, name: string): Promise<void>
}) {
  const image = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const textBox = useRef<HTMLTextAreaElement>(null)
  const active = useRef<Stroke | null>(null)
  const drag = useRef<TextDrag | null>(null)
  const [size, setSize] = useState({ width: 1280, height: 720 })
  const [ready, setReady] = useState(false)
  const [tool, setTool] = useState<DrawingTool>('pen')
  const [color, setColor] = useState(colors[0])
  const [width, setWidth] = useState(4)
  const [opacities, setOpacities] = useState({ pen: 100, highlighter: 35, arrow: 100, text: 100 })
  const opacity = tool === 'eraser' ? 100 : opacities[tool]
  const [textSize, setTextSize] = useState(textSizes[1].px)
  const [textStyle, setTextStyle] = useState<TextStyle>('outline')
  const [editing, setEditing] = useState<TextEdit | null>(null)
  const [stageWidth, setStageWidth] = useState(0)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [redo, setRedo] = useState<Stroke[][]>([])
  const [history, setHistory] = useState<Stroke[][]>([])
  const [body, setBody] = useState('')
  const [name, setName] = useState(() => fixedName ?? savedCoachName())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [drawing, setDrawing] = useState(false)
  /** Committed strokes with any text being typed or dragged laid over them. */
  function layered(next: Stroke[], edit: TextEdit | null) {
    let list = next
    if (edit)
      list =
        edit.index === null
          ? [...list, edit.stroke]
          : list.map((stroke, index) => (index === edit.index ? edit.stroke : stroke))
    const moving = drag.current
    if (moving?.moved)
      list = list.map((stroke, index) => (index === moving.index ? moving.stroke : stroke))
    return active.current ? [...list, active.current] : list
  }
  function repaint(next = strokes, edit = editing) {
    const context = canvas.current?.getContext('2d')
    if (context) paintStrokes(context, layered(next, edit))
  }
  useEffect(() => {
    repaint()
  }, [strokes, size, editing])
  useEffect(() => {
    const element = stage.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setStageWidth(element.clientWidth))
    observer.observe(element)
    setStageWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  function commit(next: Stroke[]) {
    setHistory((all) => [...all, strokes])
    setRedo([])
    setStrokes(next)
  }
  /** Ends typing, keeping the text; empty text removes the block. Returns the strokes. */
  function commitText(): Stroke[] {
    if (!editing) return strokes
    setEditing(null)
    const text = editing.stroke.text?.replace(/\s+$/, '') ?? ''
    const stroke = { ...editing.stroke, text }
    let next: Stroke[]
    if (editing.index === null) next = text ? [...strokes, stroke] : strokes
    else {
      const original = strokes[editing.index]
      if (!text) next = strokes.filter((_, index) => index !== editing.index)
      else if (JSON.stringify(original) === JSON.stringify(stroke)) next = strokes
      else next = strokes.map((value, index) => (index === editing.index ? stroke : value))
    }
    if (next !== strokes) commit(next)
    return next
  }
  /** Sidebar changes restyle the text being typed as well as future text. */
  function restyle(change: Partial<Stroke>, refocus = false) {
    if (!editing) return
    setEditing({ ...editing, stroke: { ...editing.stroke, ...change } })
    if (refocus) requestAnimationFrame(() => textBox.current?.focus())
  }
  function chooseTool(next: DrawingTool) {
    if (next !== 'text') commitText()
    setTool(next)
  }
  function hoverCursor(event: PointerEvent<HTMLCanvasElement>) {
    if (active.current || drag.current) return
    if (tool !== 'text') {
      event.currentTarget.style.cursor = ''
      return
    }
    const context = event.currentTarget.getContext('2d')
    const over = context && textAt(context, strokes, point(event)) !== -1
    event.currentTarget.style.cursor = over ? 'move' : 'text'
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }
  function finish(event: PointerEvent<HTMLCanvasElement>, cancel = false) {
    const moving = drag.current
    if (moving && event.currentTarget.hasPointerCapture(event.pointerId)) {
      drag.current = null
      setDrawing(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
      if (cancel) repaint()
      else if (moving.moved)
        commit(strokes.map((stroke, index) => (index === moving.index ? moving.stroke : stroke)))
      // A click without a drag edits the text.
      else setEditing({ index: moving.index, stroke: strokes[moving.index], key: Date.now() })
      return
    }
    if (!active.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const stroke = active.current
    active.current = null
    setDrawing(false)
    if (!cancel) commit([...strokes, stroke])
    event.currentTarget.releasePointerCapture(event.pointerId)
    repaint(cancel ? strokes : [...strokes, stroke])
  }
  async function save() {
    if (!ready || saving || drawing) return
    // The canvas already shows text being typed; keep it in the drawing.
    commitText()
    setSaving(true)
    setError('')
    try {
      const result = canvasFor(image.current!, size.width, size.height)
      result.getContext('2d')!.drawImage(canvas.current!, 0, 0, result.width, result.height)
      await onSave(encodeCapture(result), body.trim(), name.trim())
      if (role === 'coach' && !fixedName) saveCoachName(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The capture did not save. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      title={`Draw at ${timeLabel}`}
      className="dialog-capture drawing-editor"
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <div className="drawing-workspace">
        <div className="drawing-view">
          <div
            ref={stage}
            className="drawing-stage"
            style={{
              maxWidth: `min(100%, calc((100dvh - 100px) * ${size.width / size.height}))`,
              marginInline: 'auto',
            }}
          >
            <img
              ref={image}
              src={frame}
              alt="Frozen video frame"
              draggable={false}
              onLoad={(event) => {
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
                setReady(true)
              }}
              onError={() =>
                setError('The frozen frame could not load. Close this dialog and try again.')
              }
            />
            <canvas
              ref={canvas}
              width={size.width}
              height={size.height}
              aria-label="Draw on the frozen video frame"
              data-tool={tool}
              // Keeps focus in the text box rather than moving it to the page.
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (!ready || saving || event.button !== 0 || active.current || drag.current) return
                event.preventDefault()
                if (tool === 'text') {
                  // A click away from the text being typed finishes it.
                  if (editing) {
                    commitText()
                    return
                  }
                  const at = point(event)
                  const hit = textAt(event.currentTarget.getContext('2d')!, strokes, at)
                  if (hit !== -1) {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drag.current = { index: hit, start: at, stroke: strokes[hit], moved: false }
                    setDrawing(true)
                    return
                  }
                  setEditing({
                    index: null,
                    key: Date.now(),
                    stroke: {
                      tool: 'text',
                      color,
                      opacity: opacity / 100,
                      width: 0,
                      fontSize: textSize / 1280,
                      textStyle,
                      text: '',
                      points: [at],
                    },
                  })
                  return
                }
                commitText()
                event.currentTarget.setPointerCapture(event.pointerId)
                active.current = {
                  tool,
                  color,
                  opacity: opacity / 100,
                  width: (width / 1280) * (tool === 'highlighter' ? 5 : tool === 'eraser' ? 6 : 1),
                  points: [point(event)],
                }
                setDrawing(true)
                repaint()
              }}
              onPointerMove={(event) => {
                const moving = drag.current
                if (moving && event.currentTarget.hasPointerCapture(event.pointerId)) {
                  const at = point(event)
                  const dx = at.x - moving.start.x
                  const dy = at.y - moving.start.y
                  if (!moving.moved && Math.hypot(dx, dy) < 0.004) return
                  const origin = strokes[moving.index].points[0]
                  moving.moved = true
                  moving.stroke = {
                    ...moving.stroke,
                    points: [
                      {
                        x: Math.max(0, Math.min(0.98, origin.x + dx)),
                        y: Math.max(0, Math.min(0.98, origin.y + dy)),
                      },
                    ],
                  }
                  repaint()
                  return
                }
                hoverCursor(event)
                if (!active.current || !event.currentTarget.hasPointerCapture(event.pointerId))
                  return
                if (active.current.points.length < 10000) active.current.points.push(point(event))
                repaint()
              }}
              onPointerUp={(event) => finish(event)}
              onPointerCancel={(event) => finish(event, true)}
              onLostPointerCapture={() => {
                if (drag.current) {
                  drag.current = null
                  setDrawing(false)
                  repaint()
                }
                if (active.current) {
                  active.current = null
                  setDrawing(false)
                  repaint()
                }
              }}
            />
            {editing && canvas.current && stageWidth > 0 && (
              <TextEditor
                key={editing.key}
                ref={textBox}
                edit={editing}
                canvas={canvas.current}
                scale={stageWidth / size.width}
                onChange={(text) => setEditing({ ...editing, stroke: { ...editing.stroke, text } })}
                onCommit={commitText}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        </div>
        <aside className="drawing-sidebar" aria-label="Drawing controls and notes">
          <p className="field-hint">
            Video paused. Draw on this frozen frame, then capture it to the timeline. Check that the
            frame is correct before saving.
          </p>
          <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
            {tools.map(({ id, name, Icon }) => (
              <button
                key={id}
                className="icon-button"
                aria-label={name}
                title={name}
                aria-pressed={tool === id}
                onClick={() => chooseTool(id)}
                disabled={saving || drawing}
              >
                <Icon size={18} />
              </button>
            ))}
            <span className="drawing-colors" role="group" aria-label="Ink color">
              {colors.map((value, index) => (
                <button
                  key={value}
                  className="drawing-color"
                  aria-label={colorNames[index]}
                  title={colorNames[index]}
                  aria-pressed={color === value}
                  style={{ backgroundColor: value }}
                  onClick={() => {
                    setColor(value)
                    restyle({ color: value }, true)
                  }}
                  disabled={saving || drawing}
                />
              ))}
            </span>
            {tool === 'text' ? (
              <>
                <label className="drawing-width">
                  Text size{' '}
                  <select
                    value={textSize}
                    onChange={(event) => {
                      const px = Number(event.target.value)
                      setTextSize(px)
                      restyle({ fontSize: px / 1280 })
                    }}
                    disabled={saving || drawing}
                  >
                    {textSizes.map(({ px, name }) => (
                      <option key={px} value={px}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="drawing-width">
                  Text style{' '}
                  <select
                    value={textStyle}
                    onChange={(event) => {
                      const next = event.target.value as TextStyle
                      setTextStyle(next)
                      restyle({ textStyle: next })
                    }}
                    disabled={saving || drawing}
                  >
                    {textStyles.map(({ id, name }) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-hint drawing-text-hint">
                  Click the frame to add text. Enter finishes, Shift+Enter adds a line. Drag text to
                  move it, or click it to edit.
                </p>
              </>
            ) : (
              <label className="drawing-width">
                Width{' '}
                <select
                  value={width}
                  onChange={(event) => setWidth(Number(event.target.value))}
                  disabled={saving || drawing}
                >
                  <option value={2}>Thin</option>
                  <option value={4}>Medium</option>
                  <option value={8}>Thick</option>
                </select>
              </label>
            )}
            <label className="drawing-opacity">
              <span>
                Opacity <output>{opacity}%</output>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={opacity}
                aria-label="Ink opacity"
                aria-valuetext={`${opacity}%`}
                disabled={saving || drawing || tool === 'eraser'}
                onChange={(event) => {
                  if (tool === 'eraser') return
                  const value = Number(event.target.value)
                  setOpacities((current) => ({ ...current, [tool]: value }))
                  if (tool === 'text') restyle({ opacity: value / 100 })
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Undo"
              title="Undo"
              disabled={!history.length || saving || drawing || !!editing}
              onClick={() => {
                setRedo((all) => [...all, strokes])
                setStrokes(history.at(-1)!)
                setHistory((all) => all.slice(0, -1))
              }}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Redo"
              title="Redo"
              disabled={!redo.length || saving || drawing || !!editing}
              onClick={() => {
                setHistory((all) => [...all, strokes])
                setStrokes(redo.at(-1)!)
                setRedo((all) => all.slice(0, -1))
              }}
            >
              <Redo2 size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Clear drawing"
              title="Clear drawing"
              disabled={!strokes.length || saving || drawing || !!editing}
              onClick={() => commit([])}
            >
              <Trash2 size={18} />
            </button>
          </div>
          <form
            className="drawing-form"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {role === 'coach' && !fixedName && (
              <label>
                Your name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  required
                  disabled={saving}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              Note (optional)
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={2000}
                rows={2}
                disabled={saving}
                placeholder="What should we notice here?"
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <div className="drawing-actions">
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button"
                disabled={!ready || saving || drawing || (role === 'coach' && !name.trim())}
              >
                <Camera size={16} />
                {saving ? 'Saving…' : 'Capture to timeline'}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </Dialog>
  )
}

/**
 * A transparent text box over the canvas: the canvas paints the letters (so the
 * preview matches the capture exactly) and the box supplies the caret,
 * selection and keyboard.
 */
function TextEditor({
  ref,
  edit,
  canvas,
  scale,
  onChange,
  onCommit,
  onCancel,
}: {
  ref: Ref<HTMLTextAreaElement>
  edit: TextEdit
  canvas: HTMLCanvasElement
  scale: number
  onChange(text: string): void
  onCommit(): void
  onCancel(): void
}) {
  const context = canvas.getContext('2d')
  if (!context) return null
  const box = textLayout(context, edit.stroke, textPlaceholder)
  return (
    <textarea
      ref={ref}
      className="drawing-text-input"
      aria-label="Text on frame"
      autoFocus
      spellCheck={false}
      maxLength={300}
      rows={1}
      wrap="off"
      value={edit.stroke.text ?? ''}
      placeholder={textPlaceholder}
      style={{
        left: box.x * scale,
        top: box.y * scale,
        width: box.width * scale + box.size * scale * 0.6,
        height: box.height * scale,
        fontSize: box.size * scale,
        lineHeight: textLineHeight,
        fontFamily: textFontFamily,
        caretColor: edit.stroke.color,
      }}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          // Cancels this text rather than closing the whole editor.
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    />
  )
}

export function CaptureThumbnail({
  capture,
  repository,
}: {
  capture: ReviewCapture
  repository: ReviewRepository
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [image, setImage] = useState('')
  useEffect(() => {
    let disposed = false
    const load = () => {
      void repository
        .getCapture?.(capture.id)
        .then((value) => {
          if (!disposed && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
            setImage(value)
        })
        .catch(() => {
          /* Opening the capture provides an actionable retry. */
        })
    }
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect()
              load()
            }
          })
    if (observer && ref.current) observer.observe(ref.current)
    else load()
    return () => {
      disposed = true
      observer?.disconnect()
    }
  }, [capture.id, repository])
  return (
    <span ref={ref} className="capture-thumb">
      {image ? (
        <img src={image} alt="Annotated frame thumbnail" />
      ) : (
        <Camera size={18} aria-hidden="true" />
      )}
    </span>
  )
}

export function CapturePreview({
  capture,
  repository,
  timeLabel,
  onClose,
  onSeek,
  onDelete,
}: {
  capture: ReviewCapture
  repository: ReviewRepository
  timeLabel: string
  onClose(): void
  onSeek?(): void
  onDelete?(): Promise<boolean>
}) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let disposed = false
    setImage('')
    setError('')
    repository.getCapture!(capture.id)
      .then((value) => {
        if (!disposed) {
          if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
            setError('The saved capture could not be loaded.')
          else setImage(value)
        }
      })
      .catch((reason) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : 'Could not load the capture.')
      })
    return () => {
      disposed = true
    }
  }, [capture.id, repository, attempt])
  return (
    <Dialog
      title={`Capture at ${timeLabel}`}
      className="dialog-capture"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {image ? (
        <img
          className="capture-preview"
          src={image}
          alt={capture.body || `Annotated video frame at ${timeLabel}`}
        />
      ) : (
        !error && <p role="status">Loading capture…</p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="button secondary button-small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {capture.body && <p className="capture-note">{capture.body}</p>}
      <p className="field-hint">
        {capture.role === 'owner' ? 'Player' : capture.author || 'Coach'}
      </p>
      <div className="drawing-actions">
        {onDelete && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                if (await onDelete()) onClose()
                else setError('The capture could not be deleted. Try again.')
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete capture
          </button>
        )}
        {onSeek && (
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              onSeek()
              onClose()
            }}
          >
            Jump to video
          </button>
        )}
      </div>
    </Dialog>
  )
}
