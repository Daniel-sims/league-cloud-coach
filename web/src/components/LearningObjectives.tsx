import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  NotebookPen,
  Pencil,
  Plus,
  Swords,
  Trash2,
} from 'lucide-react'
import { Dialog } from './Dialog'
import {
  currentObjectives,
  objectiveDetailsMax,
  objectivePhases,
  objectivesTitle,
  objectiveTitleMax,
  ownerObjectives,
  type Objective,
  type ObjectiveChange,
  type ObjectiveDraft,
  type ObjectiveList,
  type ObjectivePhase,
  type ObjectivesRepository,
} from '../lib/objectives'

const shortDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(value))

/** Loads one owner's objectives and applies changes; every change returns the whole list. */
export function useObjectives(repository: ObjectivesRepository) {
  const [list, setList] = useState<ObjectiveList | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const load = useCallback(
    async (clearError = true) => {
      try {
        const next = await repository.load()
        if (!alive.current) return
        if (!next) throw new Error('Learning objectives aren’t available from this link.')
        setList(next)
        if (clearError) setError('')
      } catch (reason) {
        if (alive.current)
          setError(reason instanceof Error ? reason.message : 'Couldn’t load the objectives.')
      }
    },
    [repository],
  )
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])
  const apply = useCallback(
    async (change: ObjectiveChange | { action: 'name'; name: string }) => {
      setBusy(true)
      try {
        const next =
          change.action === 'name'
            ? await repository.setPlayerName!(change.name)
            : await repository.change(change)
        if (alive.current) {
          setList(next)
          setError('')
        }
        return true
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : 'Couldn’t save that change. Try again.'
        if (alive.current) setError(message)
        // Someone else changed it: show them the latest, keep any open form.
        if (/changed or was removed/.test(message)) void load(false)
        return false
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [repository, load],
  )
  return { role: repository.role, list, error, busy, load, apply }
}
export type ObjectivesModel = ReturnType<typeof useObjectives>

/** Who last changed an objective, from the reader's point of view. */
function attribution(objective: Objective, model: ObjectivesModel) {
  const verb = objective.createdAt === objective.updatedAt ? 'Added' : 'Updated'
  const who =
    objective.editedRole === 'coach'
      ? (objective.editedBy ?? 'Coach')
      : model.role === 'owner'
        ? 'you'
        : model.list?.playerName?.trim() || 'the player'
  return `${verb} by ${who} · ${shortDate(objective.updatedAt)}`
}

type Editing = string | `new:${ObjectivePhase}` | null

export function ObjectiveBoard({ model, editable }: { model: ObjectivesModel; editable: boolean }) {
  const [editing, setEditing] = useState<Editing>(null)
  if (!model.list)
    return model.error ? (
      <div className="notice error" role="alert">
        {model.error}
      </div>
    ) : (
      <div className="loading-state objectives-loading" role="status">
        <LoaderCircle className="spin" size={18} />
        Loading objectives…
      </div>
    )
  const current = currentObjectives(model.list)
  const past = model.list.objectives.filter((o) => o.archivedAt)
  const save = async (draft: ObjectiveDraft, objective?: Objective) => {
    const done = await model.apply(
      objective
        ? { action: 'update', id: objective.id, revision: objective.revision, ...draft }
        : { action: 'create', ...draft },
    )
    if (done) setEditing(null)
  }
  return (
    <div className="objective-board">
      {model.error && (
        <div className="notice error" role="alert">
          {model.error}
        </div>
      )}
      {!editable && current.length === 0 && (
        <p className="blocks-empty">No learning objectives yet.</p>
      )}
      {objectivePhases.map(({ phase, name, hint }) => {
        const items = current.filter((o) => o.phase === phase)
        if (!editable && items.length === 0) return null
        return (
          <section className="objective-phase" key={phase} aria-label={`${name} objectives`}>
            <header>
              <span className="objective-phase-icon" aria-hidden="true">
                {phase === 'in_game' ? <Swords size={16} /> : <NotebookPen size={16} />}
              </span>
              <div>
                <h3>{name}</h3>
                <small>{hint}</small>
              </div>
              {editable && (
                <button
                  className="button secondary button-small objective-add"
                  aria-label={`Add ${name.toLowerCase()} objective`}
                  disabled={model.busy || editing !== null}
                  onClick={() => setEditing(`new:${phase}`)}
                >
                  <Plus size={14} />
                  Add
                </button>
              )}
            </header>
            {items.length > 0 && (
              <ol className="objective-list">
                {items.map((objective, index) =>
                  editing === objective.id ? (
                    <li key={objective.id} className="objective editing">
                      <ObjectiveForm
                        initial={objective}
                        busy={model.busy}
                        onCancel={() => setEditing(null)}
                        onSave={(draft) => save(draft, objective)}
                        onDelete={async () => {
                          if (await model.apply({ action: 'delete', id: objective.id }))
                            setEditing(null)
                        }}
                      />
                    </li>
                  ) : (
                    <li key={objective.id} className="objective">
                      <span className="objective-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="objective-body">
                        <strong>{objective.title}</strong>
                        {objective.details && (
                          <p className="objective-details">{objective.details}</p>
                        )}
                        {editable && (
                          <small className="objective-meta">{attribution(objective, model)}</small>
                        )}
                      </div>
                      {editable && (
                        <div className="objective-actions">
                          <button
                            className="icon-button"
                            aria-label={`Move “${objective.title}” up`}
                            title="Move up"
                            disabled={model.busy || index === 0}
                            onClick={() => void model.apply({ action: 'up', id: objective.id })}
                          >
                            <ChevronUp size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Move “${objective.title}” down`}
                            title="Move down"
                            disabled={model.busy || index === items.length - 1}
                            onClick={() => void model.apply({ action: 'down', id: objective.id })}
                          >
                            <ChevronDown size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Edit “${objective.title}”`}
                            title="Edit"
                            disabled={model.busy || editing !== null}
                            onClick={() => setEditing(objective.id)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Archive “${objective.title}”`}
                            title="Archive: move to past objectives"
                            disabled={model.busy}
                            onClick={() =>
                              void model.apply({ action: 'archive', id: objective.id })
                            }
                          >
                            <Archive size={14} />
                          </button>
                        </div>
                      )}
                    </li>
                  ),
                )}
              </ol>
            )}
            {editable && editing === `new:${phase}` ? (
              <div className="objective editing">
                <ObjectiveForm
                  initial={{ phase, title: '', details: '' }}
                  busy={model.busy}
                  onCancel={() => setEditing(null)}
                  onSave={(draft) => save(draft)}
                />
              </div>
            ) : (
              items.length === 0 && (
                <p className="objective-empty">No {name.toLowerCase()} objectives yet.</p>
              )
            )}
          </section>
        )
      })}
      {editable && past.length > 0 && (
        <details className="objective-past">
          <summary>Past objectives ({past.length})</summary>
          <ul className="objective-list">
            {past.map((objective) => (
              <li key={objective.id} className="objective archived">
                <div className="objective-body">
                  <strong>{objective.title}</strong>
                  {objective.details && <p className="objective-details">{objective.details}</p>}
                  <small className="objective-meta">
                    {objectivePhases.find((p) => p.phase === objective.phase)?.name} · Archived{' '}
                    {shortDate(objective.archivedAt!)}
                  </small>
                </div>
                <div className="objective-actions">
                  <button
                    className="icon-button"
                    aria-label={`Restore “${objective.title}”`}
                    title="Restore to current objectives"
                    disabled={model.busy}
                    onClick={() => void model.apply({ action: 'restore', id: objective.id })}
                  >
                    <ArchiveRestore size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete “${objective.title}”`}
                    title="Delete for good"
                    disabled={model.busy}
                    onClick={() => void model.apply({ action: 'delete', id: objective.id })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ObjectiveForm({
  initial,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  initial: ObjectiveDraft
  busy: boolean
  onCancel(): void
  onSave(draft: ObjectiveDraft): Promise<void>
  onDelete?(): Promise<void>
}) {
  const [phase, setPhase] = useState(initial.phase)
  const [title, setTitle] = useState(initial.title)
  const [details, setDetails] = useState(initial.details)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || busy) return
    void onSave({ phase, title: title.trim(), details: details.trim() })
  }
  return (
    <form className="objective-form" onSubmit={submit}>
      <div className="objective-phase-choice" role="radiogroup" aria-label="When">
        {objectivePhases.map((p) => (
          <button
            key={p.phase}
            type="button"
            role="radio"
            aria-checked={phase === p.phase}
            className={`button button-small ${phase === p.phase ? '' : 'secondary'}`}
            onClick={() => setPhase(p.phase)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <input
        aria-label="Objective"
        value={title}
        maxLength={objectiveTitleMax}
        autoFocus
        placeholder="e.g. R usage: build patience"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <textarea
        aria-label="Details"
        value={details}
        rows={4}
        maxLength={objectiveDetailsMax}
        placeholder="How to work on it, what to look for, a reminder…"
        onChange={(event) => setDetails(event.target.value)}
      />
      <div className="objective-form-actions">
        {onDelete &&
          (confirmDelete ? (
            <span className="objective-confirm">
              Delete for good?
              <button
                type="button"
                className="text-link danger-link"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                Delete
              </button>
              <button type="button" className="text-link" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="text-link danger-link"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={12} />
              Delete
            </button>
          ))}
        <span className="objective-form-spacer" />
        <button type="button" className="button secondary button-small" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button-small" disabled={busy || !title.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

/** The objectives in a modal, editable: from the review's settings or after completing a review. */
export function ObjectivesDialog({
  repository,
  intro,
  onClose,
}: {
  repository: ObjectivesRepository
  intro?: string
  onClose(): void
}) {
  const model = useObjectives(repository)
  const player = model.list?.playerName?.trim() || 'the player'
  return (
    <Dialog
      title={objectivesTitle(model.role, model.list?.playerName)}
      wide
      className="dialog-objectives"
      onClose={onClose}
    >
      <p className="dialog-intro">
        {intro ??
          (model.role === 'owner'
            ? 'In-game objectives are for while you play; post-game objectives are for reviewing. Coaches see these on your watch links.'
            : `What ${player} is working on. In-game objectives are for while they play; post-game objectives are for their reviews.`)}
      </p>
      <ObjectiveBoard model={model} editable />
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  )
}

/** Shown once when a coach opens a watch link: what the player is working on. */
export function ObjectivesBriefing({ repository }: { repository: ObjectivesRepository }) {
  const model = useObjectives(repository)
  const [open, setOpen] = useState(true)
  if (!open || currentObjectives(model.list).length === 0) return null
  const player = model.list?.playerName?.trim() || 'the player'
  return (
    <Dialog
      title={objectivesTitle('coach', model.list?.playerName)}
      wide
      className="dialog-objectives"
      onClose={() => setOpen(false)}
    >
      <p className="dialog-intro">
        What {player} is working on right now. Keep these in mind as you review. You can update them
        from the review settings, or when you complete your review.
      </p>
      <ObjectiveBoard model={model} editable={false} />
      <div className="dialog-actions">
        <button className="button" onClick={() => setOpen(false)}>
          Start reviewing
        </button>
      </div>
    </Dialog>
  )
}

function PlayerName({ model }: { model: ObjectivesModel }) {
  const saved = model.list?.playerName ?? ''
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(saved)
  if (editing)
    return (
      <form
        className="objective-player-name"
        onSubmit={async (event) => {
          event.preventDefault()
          if (await model.apply({ action: 'name', name })) setEditing(false)
        }}
      >
        <input
          aria-label="Your name for coaches"
          value={name}
          maxLength={40}
          autoFocus
          placeholder="Your first name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="button button-small" disabled={model.busy}>
          Save
        </button>
        <button
          type="button"
          className="button secondary button-small"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </form>
    )
  return (
    <p className="objective-player-name">
      Coaches see these when they open a watch link, as “{objectivesTitle('coach', saved)}”.
      <button
        className="text-link"
        onClick={() => {
          setName(saved)
          setEditing(true)
        }}
      >
        {saved ? 'Change name' : 'Add your name'}
      </button>
    </p>
  )
}

export function LearningObjectives({
  repository = ownerObjectives,
}: {
  repository?: ObjectivesRepository
}) {
  const model = useObjectives(repository)
  // Pick up a coach's changes when coming back to the tab.
  useEffect(() => {
    const refresh = () => void model.load()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [model.load])
  return (
    <section className="blocks-page objectives-page">
      <div className="blocks-head">
        <div>
          <span className="eyebrow">REVIEW · OBJECTIVES · REVIEW</span>
          <h1>Learning objectives</h1>
          <p className="blocks-lede">
            What you and your coach are working on, updated at the end of each review. In-game
            objectives are for while you play; post-game objectives are for reviewing the game.
          </p>
        </div>
      </div>
      {model.list && repository.setPlayerName && <PlayerName model={model} />}
      <ObjectiveBoard model={model} editable />
    </section>
  )
}
