import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, Trash2, X } from 'lucide-react'
import { Dialog } from './Dialog'
import {
  blockRepository,
  cleanDraft,
  type Block,
  type BlockDraft,
  type BlockRepository,
} from '../lib/blocks'

const saveDelayMs = 800

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(value),
  )

const blockName = (block: Pick<Block, 'title' | 'createdAt'>) =>
  block.title || `Block · ${dateLabel(block.createdAt)}`

function useBlocks(repository: BlockRepository) {
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    repository
      .list()
      .then((rows) => active && setBlocks(rows ?? []))
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [repository])
  return { blocks, error }
}

export function BlockList({ repository = blockRepository }: { repository?: BlockRepository }) {
  const { blocks, error } = useBlocks(repository)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const create = async () => {
    setCreating(true)
    setCreateError('')
    try {
      const block = await repository.create('')
      window.location.hash = `/blocks/${block.id}`
    } catch (e) {
      setCreateError((e as Error).message)
      setCreating(false)
    }
  }
  return (
    <section className="blocks-page">
      <div className="blocks-head">
        <div>
          <span className="eyebrow">BLOCKS</span>
          <h1>Blocks</h1>
          <p className="blocks-lede">
            A few games, played on purpose. Write as you go, then carry what you learned into the
            next block.
          </p>
        </div>
        <button className="button" onClick={() => void create()} disabled={creating}>
          {creating ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
          New block
        </button>
      </div>
      {(error || createError) && <div className="notice error">{error || createError}</div>}
      {!blocks && !error ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Loading blocks…
        </div>
      ) : blocks && blocks.length === 0 ? (
        <p className="blocks-empty">No blocks yet. Start one before your next games.</p>
      ) : (
        <ul className="blocks-list">
          {blocks?.map((block) => (
            <li key={block.id}>
              <a className="block-card" href={`#/blocks/${block.id}`}>
                <strong>{blockName(block)}</strong>
                <span>
                  {block.games.length} {block.games.length === 1 ? 'game' : 'games'} ·{' '}
                  {block.carryForward.length} {block.carryForward.length === 1 ? 'point' : 'points'}{' '}
                  to carry forward · {dateLabel(block.createdAt)}
                </span>
                <ArrowRight size={16} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

export function BlockView({
  id,
  repository = blockRepository,
}: {
  id: string
  repository?: BlockRepository
}) {
  const { blocks, error } = useBlocks(repository)
  const block = blocks?.find((b) => b.id === id)
  if (error) return <div className="notice error">{error}</div>
  if (!blocks)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" />
        Loading block…
      </div>
    )
  if (!block)
    return (
      <section className="blocks-page">
        <a className="text-link" href="#/blocks">
          <ArrowLeft size={14} /> All blocks
        </a>
        <p className="blocks-empty">This block doesn’t exist.</p>
      </section>
    )
  return <BlockEditor key={block.id} block={block} repository={repository} />
}

function BlockEditor({ block, repository }: { block: Block; repository: BlockRepository }) {
  const [draft, setDraft] = useState<BlockDraft>({
    title: block.title,
    games: block.games,
    carryForward: block.carryForward,
  })
  const [state, setState] = useState<SaveState>('saved')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const latest = useRef(draft)
  const revision = useRef(block.revision)
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
        const saved = await repository.save(block.id, revision.current, sent)
        revision.current = saved.revision
        if (alive.current) setState(dirty.current ? 'unsaved' : 'saved')
        setMessage('')
      } catch (e) {
        // Keep the text on screen; stop saving so a stale tab cannot overwrite newer notes.
        dirty.current = true
        stopped.current =
          (e as { code?: string }).code === '40001' || /another tab/.test((e as Error).message)
        if (alive.current) {
          setState('error')
          setMessage(
            stopped.current
              ? 'This block changed in another tab. Copy anything you need, then reload to see the latest.'
              : `Couldn’t save: ${(e as Error).message}. Your text is still here; keep editing to retry.`,
          )
        }
      }
    })
    return saving.current
  }, [repository, block.id])

  const edit = (next: BlockDraft) => {
    latest.current = next
    dirty.current = true
    setDraft(next)
    if (!stopped.current) setState('unsaved')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), saveDelayMs)
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      void flush()
    }
  }, [flush])

  const setGame = (gameId: string, patch: Partial<{ title: string; notes: string }>) =>
    edit({
      ...draft,
      games: draft.games.map((g) => (g.id === gameId ? { ...g, ...patch } : g)),
    })
  const addGame = () =>
    edit({
      ...draft,
      games: [...draft.games, { id: crypto.randomUUID(), title: '', notes: '' }],
    })
  const setPoint = (index: number, value: string) =>
    edit({ ...draft, carryForward: draft.carryForward.map((p, i) => (i === index ? value : p)) })

  const remove = async () => {
    setDeleting(true)
    try {
      stopped.current = true
      window.clearTimeout(timer.current)
      await saving.current
      await repository.remove(block.id)
      window.location.hash = '/blocks'
    } catch (e) {
      stopped.current = false
      setMessage((e as Error).message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <section className="blocks-page block-editor">
      <div className="block-toolbar">
        <a className="text-link" href="#/blocks">
          <ArrowLeft size={14} /> All blocks
        </a>
        <span className={`save-state ${state}`} role="status">
          {state === 'saving' ? (
            <>
              <LoaderCircle size={13} className="spin" /> Saving…
            </>
          ) : state === 'saved' ? (
            <>
              <Check size={13} /> Saved
            </>
          ) : state === 'error' ? (
            'Not saved'
          ) : (
            'Unsaved changes'
          )}
        </span>
      </div>
      <input
        className="block-title"
        value={draft.title}
        maxLength={80}
        placeholder={blockName({ title: '', createdAt: block.createdAt })}
        aria-label="Block title"
        onChange={(e) => edit({ ...draft, title: e.target.value })}
        onBlur={() => void flush()}
      />
      {message && <div className="notice error">{message}</div>}

      <div className="block-section carry-in">
        <h2>Carrying in</h2>
        {block.carryIn.length ? (
          <ul>
            {block.carryIn.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        ) : (
          <p className="blocks-empty">
            Nothing carried in yet. Your first block’s summary will show up here next time.
          </p>
        )}
      </div>

      {draft.games.map((game, index) => (
        <div className="block-section block-game" key={game.id}>
          <div className="block-game-head">
            <input
              value={game.title}
              maxLength={80}
              placeholder={`Game ${index + 1}`}
              aria-label={`Game ${index + 1} title`}
              onChange={(e) => setGame(game.id, { title: e.target.value })}
              onBlur={() => void flush()}
            />
            <button
              className="icon-button"
              aria-label={`Remove game ${index + 1}`}
              title="Remove game"
              onClick={() => edit({ ...draft, games: draft.games.filter((g) => g.id !== game.id) })}
            >
              <X size={16} />
            </button>
          </div>
          <textarea
            value={game.notes}
            maxLength={20000}
            rows={6}
            placeholder="How did it go? What did you notice, and what would you do differently?"
            aria-label={`Game ${index + 1} notes`}
            onChange={(e) => setGame(game.id, { notes: e.target.value })}
            onBlur={() => void flush()}
          />
        </div>
      ))}
      <button
        className="button secondary add-game"
        onClick={addGame}
        disabled={draft.games.length >= 30}
      >
        <Plus size={16} />
        Add game
      </button>

      <div className="block-section summary">
        <h2>Carry forward</h2>
        <p className="blocks-lede">What to take into your next block.</p>
        <ul className="point-list">
          {draft.carryForward.map((point, index) => (
            <li key={index}>
              <input
                value={point}
                maxLength={300}
                aria-label={`Carry-forward point ${index + 1}`}
                onChange={(e) => setPoint(index, e.target.value)}
                onBlur={() => void flush()}
              />
              <button
                className="icon-button"
                aria-label={`Remove point ${index + 1}`}
                title="Remove point"
                onClick={() =>
                  edit({ ...draft, carryForward: draft.carryForward.filter((_, i) => i !== index) })
                }
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
        <button
          className="button secondary button-small"
          onClick={() => edit({ ...draft, carryForward: [...draft.carryForward, ''] })}
          disabled={draft.carryForward.length >= 30}
        >
          <Plus size={14} />
          Add point
        </button>
      </div>

      <div className="block-footer">
        <button className="text-link danger-link" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={14} /> Delete block
        </button>
      </div>
      {confirmDelete && (
        <Dialog title="Delete this block?" onClose={() => !deleting && setConfirmDelete(false)}>
          <p className="dialog-intro">
            The games and notes in{' '}
            {blockName({ title: cleanDraft(draft).title, createdAt: block.createdAt })} will be
            removed for good.
          </p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button className="button danger" onClick={() => void remove()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete block'}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
