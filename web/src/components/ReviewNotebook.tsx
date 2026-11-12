import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, Copy, NotebookPen, Clock3 } from 'lucide-react'
import { Dialog } from './Dialog'
import {
  savedCoachName,
  saveCoachName,
  type ReviewNotes,
  type ReviewRepository,
} from '../lib/review'

const emptyNotes: ReviewNotes = { draft: null, reviews: [], guestDrafts: [] }

const liveRefreshMs = 6000

export function useReviewNotebook(repository: ReviewRepository | null) {
  const defaultName = () => repository?.guestName ?? savedCoachName()
  const [view, setView] = useState<'timeline' | 'notes'>('timeline')
  const [finishing, setFinishing] = useState(false)
  const [data, setData] = useState<ReviewNotes>(emptyNotes)
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState(defaultName)
  const [savedBody, setSavedBody] = useState('')
  const [savedAuthor, setSavedAuthor] = useState(defaultName)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState('')
  const session = useMemo(
    () => ({
      active: true,
      ready: false,
      body: '',
      author: defaultName(),
      savedBody: '',
      savedAuthor: defaultName(),
      version: 0,
      pending: 0,
      queue: Promise.resolve(),
    }),
    [repository],
  )
  const isDirty = () =>
    session.body !== session.savedBody ||
    (repository?.role === 'coach' &&
      session.body.length > 0 &&
      session.author !== session.savedAuthor)
  const dirty =
    body !== savedBody ||
    (repository?.role === 'coach' && body.length > 0 && author !== savedAuthor)

  const changeBody = (value: string) => {
    session.body = value
    setBody(value)
  }
  const changeAuthor = (value: string) => {
    session.author = value
    setAuthor(value)
  }
  const load = useCallback(
    async (replace = false) => {
      if (!repository?.loadNotes) return
      try {
        const next = await repository.loadNotes()
        if (!next) throw new Error('Review notes are not available for this recording.')
        if (!session.active) return
        setData(next)
        if (replace || (!isDirty() && session.pending === 0)) {
          session.body = session.savedBody = next.draft?.body ?? ''
          session.author = session.savedAuthor =
            repository.guestName ?? next.draft?.author ?? savedCoachName()
          session.version = next.draft?.version ?? 0
          setBody(session.body)
          setSavedBody(session.body)
          setAuthor(session.author)
          setSavedAuthor(session.author)
        }
        session.ready = true
        setReady(true)
        setError('')
      } catch (reason) {
        if (session.active)
          setError(reason instanceof Error ? reason.message : 'Could not load review notes.')
      }
    },
    [repository, session],
  )

  const persist = useCallback(
    (complete = false) => {
      if (!repository?.saveNotes || !session.ready)
        return Promise.reject(new Error('Wait for your saved notes to load.'))
      const text = session.body,
        rawName = session.author,
        name = rawName.trim()
      session.pending++
      if (session.active) setSaving(true)
      const result = session.queue
        .then(async () => {
          if (
            !complete &&
            text === session.savedBody &&
            (repository.role !== 'coach' || rawName === session.savedAuthor)
          )
            return
          try {
            const next = await repository.saveNotes!({
              body: text,
              author: name,
              version: session.version,
              complete,
            })
            if (!next?.draft)
              throw new Error('Your notes could not be saved. Your draft is still here.')
            session.version = next.draft.version
            session.savedBody = text
            session.savedAuthor = rawName
            if (repository.role === 'coach' && !repository.guestName) saveCoachName(name)
            if (session.active) {
              setData(next)
              setSavedBody(text)
              setSavedAuthor(rawName)
              setError('')
            }
          } catch (reason) {
            if (session.active)
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Could not save your notes. Your draft is still here.',
              )
            throw reason
          }
        })
        .finally(() => {
          session.pending--
          if (session.active) setSaving(session.pending > 0)
        })
      session.queue = result.catch(() => {})
      return result
    },
    [repository, session],
  )

  useEffect(() => {
    session.active = true
    setReady(false)
    setBody('')
    setSavedBody('')
    setData(emptyNotes)
    setError('')
    setView('timeline')
    setFinishing(false)
    void load()
    const focus = () => {
      if (!isDirty() && session.pending === 0) void load()
    }
    window.addEventListener('focus', focus)
    return () => {
      session.active = false
      window.removeEventListener('focus', focus)
      if (session.ready && isDirty() && (repository?.role !== 'coach' || session.author.trim()))
        void persist().catch(() => {})
    }
  }, [repository, session, load, persist])
  // Live review: pick up what the other side is writing without a reload.
  useEffect(() => {
    if (!repository?.loadNotes) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !isDirty() && session.pending === 0) void load()
    }, liveRefreshMs)
    return () => window.clearInterval(timer)
  }, [repository, session, load])
  useEffect(() => {
    if (!ready || !dirty || finishing || error || (repository?.role === 'coach' && !author.trim()))
      return
    const timer = window.setTimeout(() => {
      void persist().catch(() => {})
    }, 700)
    return () => window.clearTimeout(timer)
  }, [body, author, ready, dirty, finishing, error, persist, repository?.role])
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (isDirty()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [session])

  const open = () => {
    setView('notes')
    if (session.ready && !isDirty() && session.pending === 0) void load()
  }
  const finish = () => {
    setView('notes')
    setFinishing(true)
  }
  const complete = async () => {
    setCompleting(true)
    try {
      await persist(true)
      setFinishing(false)
    } catch {
      /* Keep the review and its draft open. */
    } finally {
      setCompleting(false)
    }
  }
  return {
    supported: Boolean(repository?.loadNotes && repository.saveNotes),
    role: repository?.role ?? 'owner',
    named: Boolean(repository?.guestName),
    view,
    setView,
    finishing,
    setFinishing,
    data,
    body,
    author,
    ready,
    saving,
    completing,
    dirty,
    error,
    changeBody,
    changeAuthor,
    load,
    persist,
    open,
    finish,
    complete,
  }
}
export type ReviewNotebookModel = ReturnType<typeof useReviewNotebook>

export function NotebookActions({ notebook }: { notebook: ReviewNotebookModel }) {
  if (!notebook.supported) return null
  return (
    <>
      <button className="button button-small secondary" onClick={notebook.open}>
        <NotebookPen size={15} />
        Add notes
      </button>
      <button
        className="button button-small secondary"
        onClick={notebook.finish}
        disabled={!notebook.ready || !notebook.body.trim() || notebook.completing}
      >
        <CheckCircle2 size={15} />
        Complete review
      </button>
    </>
  )
}

function NotesError({ notebook }: { notebook: ReviewNotebookModel }) {
  const [copied, setCopied] = useState(false)
  if (!notebook.error) return null
  return (
    <div className="notice error notebook-error" role="alert">
      <p>{notebook.error}</p>
      {notebook.body && (
        <button
          className="button secondary button-small"
          onClick={() => {
            void navigator.clipboard
              .writeText(notebook.body)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy notes'}
        </button>
      )}
      {notebook.ready && !notebook.error.includes('another tab') ? (
        <button
          className="button secondary button-small"
          onClick={() => {
            void notebook.persist().catch(() => {})
          }}
        >
          Try saving again
        </button>
      ) : (
        <button className="button secondary button-small" onClick={() => void notebook.load(true)}>
          Load saved notes
        </button>
      )}
    </div>
  )
}

export function ReviewNotebook({
  notebook,
  timeLabel,
  cinemaControl,
}: {
  notebook: ReviewNotebookModel
  timeLabel?: () => string
  cinemaControl?: ReactNode
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const ownPublished = notebook.data.reviews.find((review) => review.mine)
  const upToDate = Boolean(ownPublished && ownPublished.body === notebook.body.trim())
  return (
    <div className="review-notebook">
      <header className="review-header">
        <h2>Review notes</h2>
        <div className="review-tools">
          {cinemaControl}
          <button
            className="button secondary button-small"
            onClick={() => notebook.setView('timeline')}
          >
            <ArrowLeft size={13} />
            Timeline
          </button>
        </div>
      </header>
      <div className="notebook-scroll">
        <p className="field-hint">
          Private notes while you watch. Complete your review to share the finished version.
        </p>
        {!notebook.ready && !notebook.error && <p role="status">Loading your notes…</p>}
        {notebook.role === 'coach' && !notebook.named && (
          <label className="notebook-field">
            Your name
            <input
              value={notebook.author}
              maxLength={60}
              autoComplete="name"
              onChange={(event) => notebook.changeAuthor(event.target.value)}
              disabled={!notebook.ready || notebook.completing}
            />
          </label>
        )}
        <label className="notebook-field">
          Running notes
          <textarea
            ref={textarea}
            aria-describedby="notebook-save-state"
            value={notebook.body}
            onChange={(event) => notebook.changeBody(event.target.value)}
            maxLength={20000}
            rows={12}
            placeholder="Jot down what you notice, questions, and ideas to work on…"
            disabled={!notebook.ready || notebook.completing}
          />
        </label>
        <div className="notebook-save-row">
          <span id="notebook-save-state" role="status">
            {notebook.saving
              ? 'Saving…'
              : notebook.error
                ? 'Not saved'
                : notebook.role === 'coach' && !notebook.author.trim() && notebook.dirty
                  ? 'Enter your name to save'
                  : notebook.dirty
                    ? 'Unsaved changes'
                    : notebook.ready
                      ? 'Private draft saved'
                      : ''}
          </span>
          {timeLabel && (
            <button
              className="text-link"
              disabled={!notebook.ready}
              onClick={() => {
                notebook.changeBody(
                  `${notebook.body.trimEnd()}${notebook.body.trim() ? '\n' : ''}${timeLabel()} — `,
                )
                textarea.current?.focus()
              }}
            >
              <Clock3 size={12} />
              Insert time
            </button>
          )}
        </div>
        <NotesError notebook={notebook} />
        <button
          className="button notebook-complete"
          onClick={notebook.finish}
          disabled={!notebook.ready || !notebook.body.trim() || notebook.completing}
        >
          <CheckCircle2 size={15} />
          Complete review
        </button>
        {upToDate && (
          <p className="notebook-complete-state" role="status">
            <CheckCircle2 size={14} />
            Review complete. The finished version is shared.
          </p>
        )}
        {ownPublished && !upToDate && (
          <p className="field-hint">
            Your previous completed review stays visible until you complete this draft.
          </p>
        )}
        {notebook.role === 'owner' && (notebook.data.guestDrafts?.length ?? 0) > 0 && (
          <section className="completed-reviews guest-drafts" aria-label="Guest notes">
            <h3>Guest notes</h3>
            {notebook.data.guestDrafts!.map((draft) => (
              <article className="completed-review" key={draft.id}>
                <div>
                  <strong>{draft.author || 'Guest'}</strong>
                  <small>Live · {new Date(draft.updatedAt).toLocaleTimeString()}</small>
                </div>
                <p>{draft.body}</p>
              </article>
            ))}
          </section>
        )}
        {notebook.data.reviews.length > 0 && (
          <section className="completed-reviews" aria-label="Completed reviews">
            <h3>Completed reviews</h3>
            {notebook.data.reviews.map((review) => (
              <article className="completed-review" key={review.id}>
                <div>
                  <strong>
                    {review.mine
                      ? 'Your review'
                      : review.role === 'owner'
                        ? 'Player review'
                        : `${review.author || 'Coach'}’s review`}
                  </strong>
                  <small>{new Date(review.completedAt).toLocaleDateString()}</small>
                </div>
                <p>{review.body}</p>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

export function CompleteReview({ notebook }: { notebook: ReviewNotebookModel }) {
  if (!notebook.finishing) return null
  return (
    <Dialog
      title="Complete review"
      className="dialog-complete-review"
      wide
      onClose={() => {
        if (!notebook.completing) notebook.setFinishing(false)
      }}
    >
      <p className="dialog-intro">
        Polish your running notes below. Completing shares this finished review with the player and
        anyone with a watch link to this video.
      </p>
      {notebook.role === 'coach' && !notebook.named && (
        <label className="notebook-field">
          Your name
          <input
            value={notebook.author}
            maxLength={60}
            onChange={(event) => notebook.changeAuthor(event.target.value)}
            disabled={notebook.completing}
          />
        </label>
      )}
      <label className="notebook-field">
        Review notes
        <textarea
          rows={12}
          maxLength={20000}
          value={notebook.body}
          onChange={(event) => notebook.changeBody(event.target.value)}
          disabled={notebook.completing}
        />
      </label>
      <NotesError notebook={notebook} />
      <div className="dialog-actions">
        <button
          className="button secondary"
          disabled={notebook.completing}
          onClick={() => notebook.setFinishing(false)}
        >
          Keep reviewing
        </button>
        <button
          className="button"
          onClick={() => void notebook.complete()}
          disabled={
            !notebook.ready ||
            !notebook.body.trim() ||
            (notebook.role === 'coach' && !notebook.author.trim()) ||
            notebook.completing
          }
        >
          {notebook.completing ? 'Completing…' : 'Complete review'}
        </button>
      </div>
    </Dialog>
  )
}
