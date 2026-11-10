import { useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  ArrowUpRight,
  Camera,
  Eraser,
  Highlighter,
  Pencil,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Dialog } from './Dialog'
import {
  canvasFor,
  encodeCapture,
  paintStrokes,
  type DrawingTool,
  type Stroke,
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
  { id: 'eraser', name: 'Eraser', Icon: Eraser },
] as const

export function DrawingCapture({
  frame,
  timeLabel,
  role,
  onClose,
  onSave,
}: {
  frame: string
  timeLabel: string
  role: 'owner' | 'coach'
  onClose(): void
  onSave(image: string, body: string, name: string): Promise<void>
}) {
  const image = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const active = useRef<Stroke | null>(null)
  const [size, setSize] = useState({ width: 1280, height: 720 })
  const [ready, setReady] = useState(false)
  const [tool, setTool] = useState<DrawingTool>('pen')
  const [color, setColor] = useState(colors[0])
  const [width, setWidth] = useState(4)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [redo, setRedo] = useState<Stroke[][]>([])
  const [history, setHistory] = useState<Stroke[][]>([])
  const [body, setBody] = useState('')
  const [name, setName] = useState(savedCoachName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [drawing, setDrawing] = useState(false)
  function repaint(next = strokes) {
    const context = canvas.current?.getContext('2d')
    if (context) paintStrokes(context, active.current ? [...next, active.current] : next)
  }
  useEffect(() => {
    repaint()
  }, [strokes, size])
  function commit(next: Stroke[]) {
    setHistory((all) => [...all, strokes])
    setRedo([])
    setStrokes(next)
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }
  function finish(event: PointerEvent<HTMLCanvasElement>, cancel = false) {
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
    setSaving(true)
    setError('')
    try {
      const result = canvasFor(image.current!, size.width, size.height)
      result.getContext('2d')!.drawImage(canvas.current!, 0, 0, result.width, result.height)
      await onSave(encodeCapture(result), body.trim(), name.trim())
      if (role === 'coach') saveCoachName(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The capture did not save. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      title={`Draw at ${timeLabel}`}
      className="dialog-capture"
      onClose={() => {
        if (!saving) onClose()
      }}
    >
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
            onClick={() => setTool(id)}
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
              onClick={() => setColor(value)}
              disabled={saving || drawing}
            />
          ))}
        </span>
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
        <button
          className="icon-button"
          aria-label="Undo"
          title="Undo"
          disabled={!history.length || saving || drawing}
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
          disabled={!redo.length || saving || drawing}
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
          disabled={!strokes.length || saving || drawing}
          onClick={() => commit([])}
        >
          <Trash2 size={18} />
        </button>
      </div>
      <div
        className="drawing-stage"
        style={{
          maxWidth: `min(100%, calc(55dvh * ${size.width / size.height}))`,
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
          onPointerDown={(event) => {
            if (!ready || saving || event.button !== 0 || active.current) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            active.current = {
              tool,
              color,
              width: (width / 1280) * (tool === 'highlighter' ? 5 : tool === 'eraser' ? 6 : 1),
              points: [point(event)],
            }
            setDrawing(true)
            repaint()
          }}
          onPointerMove={(event) => {
            if (!active.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            if (active.current.points.length < 10000) active.current.points.push(point(event))
            repaint()
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={() => {
            if (active.current) {
              active.current = null
              setDrawing(false)
              repaint()
            }
          }}
        />
      </div>
      <form
        className="drawing-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {role === 'coach' && (
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
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
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
    </Dialog>
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
