import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, Pencil } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  objectivesMaxLength,
  objectivesRepository,
  type LearningObjectives as Objectives,
  type ObjectivesRepository,
} from '../lib/objectives'

const saveDelayMs = 800

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

const updatedLabel = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

export function LearningObjectives({
  repository = objectivesRepository,
}: {
  repository?: ObjectivesRepository
}) {
  const [loaded, setLoaded] = useState<Objectives | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    repository
      .get()
      .then((row) => active && setLoaded(row ?? { body: '', revision: 0, updatedAt: null }))
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [repository])

  return (
    <section className="blocks-page objectives-page">
      <div className="blocks-head">
        <div>
          <span className="eyebrow">BEFORE YOU QUEUE</span>
          <h1>Learning objectives</h1>
          <p className="blocks-lede">
            What your coach wants you focused on. Read it before every game.
          </p>
        </div>
      </div>
      {error ? (
        <div className="notice error">{error}</div>
      ) : !loaded ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Loading objectives…
        </div>
      ) : (
        <ObjectivesEditor initial={loaded} repository={repository} />
      )}
    </section>
  )
}

function ObjectivesEditor({
  initial,
  repository,
}: {
  initial: Objectives
  repository: ObjectivesRepository
}) {
  const [body, setBody] = useState(initial.body)
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt)
  const [editing, setEditing] = useState(!initial.body.trim())
  const [state, setState] = useState<SaveState>('saved')
  const [message, setMessage] = useState('')
  const latest = useRef(initial.body)
  const revision = useRef(initial.revision)
  const dirty = useRef(false)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  const stopped = useRef(false)
  const alive = useRef(true)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    saving.current = saving.current.then(async () => {
      if (!dirty.current || stopped.current) return
      const sent = latest.current
      dirty.current = false
      if (alive.current) setState('saving')
      try {
        const saved = await repository.save(revision.current, sent)
        revision.current = saved.revision
        if (alive.current) {
          setUpdatedAt(saved.updatedAt)
          setState(dirty.current ? 'unsaved' : 'saved')
          setMessage('')
        }
      } catch (e) {
        // Keep the text on screen; stop saving so a stale tab cannot overwrite newer objectives.
        dirty.current = true
        stopped.current = /another tab/.test((e as Error).message)
        if (alive.current) {
          setState('error')
          setMessage(
            stopped.current
              ? 'Your objectives changed in another tab. Copy anything you need, then reload to see the latest.'
              : `Couldn’t save: ${(e as Error).message}. Your text is still here; keep editing to retry.`,
          )
        }
      }
    })
    return saving.current
  }, [repository])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      void flush()
    }
  }, [flush])

  const edit = (next: string) => {
    latest.current = next
    dirty.current = true
    setBody(next)
    if (!stopped.current) setState('unsaved')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), saveDelayMs)
  }

  const empty = !body.trim()

  return (
    <>
      <div className="block-toolbar">
        <span className={`save-state ${state}`} role="status">
          {state === 'saving' ? (
            <>
              <LoaderCircle size={13} className="spin" /> Saving…
            </>
          ) : state === 'error' ? (
            'Not saved'
          ) : state === 'unsaved' ? (
            'Unsaved changes'
          ) : updatedAt ? (
            <>
              <Check size={13} /> Updated {updatedLabel(updatedAt)}
            </>
          ) : null}
        </span>
        {editing ? (
          <button
            className="button button-small"
            onClick={() => {
              void flush()
              setEditing(false)
            }}
          >
            <Check size={14} />
            Done
          </button>
        ) : (
          <button className="button secondary button-small" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            Edit
          </button>
        )}
      </div>
      {message && <div className="notice error">{message}</div>}
      {editing ? (
        <>
          <textarea
            className="objectives-input"
            value={body}
            maxLength={objectivesMaxLength}
            autoFocus
            aria-label="Learning objectives"
            placeholder={
              '# This week\n\n- Ward the river before 3:00\n- Track the enemy jungler’s first clear\n\n## Mindset\n\n> One focus per game. Mute and play.'
            }
            onChange={(e) => edit(e.target.value)}
            onBlur={() => void flush()}
          />
          <p className="blocks-empty objectives-hint">
            Markdown: <code># Heading</code> <code>- list</code> <code>**bold**</code>{' '}
            <code>*italic*</code> <code>&gt; quote</code> <code>- [ ] checklist</code>
          </p>
        </>
      ) : empty ? (
        <div className="block-section objectives-empty">
          <p className="blocks-empty">
            No objectives yet. Write down what your coach wants you to focus on.
          </p>
          <button className="button secondary button-small" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            Write objectives
          </button>
        </div>
      ) : (
        <article className="objectives-doc">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node: _node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
            }}
          >
            {body}
          </Markdown>
        </article>
      )}
    </>
  )
}
