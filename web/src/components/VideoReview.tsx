import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  ArrowDownToLine,
  Clock3,
  Filter,
  Link2,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
} from 'lucide-react'
import { Dialog } from './Dialog'
import { CommentRow, EventRow, patchOf } from './TimelineRows'
import type { PlayerController } from '../lib/player'
import {
  buildTimeline,
  clock,
  entryKinds,
  filterKinds,
  gameTimeMs,
  parseGameClock,
  videoOffset,
  type ClockAnchor,
  type EntryKind,
  type TimelineEntry,
} from '../lib/review-timeline'
import {
  commentKinds,
  saveCoachName,
  savedCoachName,
  type CommentKind,
  type ReviewComment,
  type ReviewData,
  type ReviewRepository,
} from '../lib/review'
import {
  championIcon,
  gamesFor,
  queues,
  roleNames,
  type Game,
  type LeagueProfile,
} from '../lib/league'
import type { LeagueRepository } from '../lib/league-repository'
import '../review.css'

/// Every event seek lands this far before the moment so it is watched
/// arriving; comments use a shorter lead, as in the Mac app.
const eventPreRollMs = 5000
const commentPreRollMs = 3000
const hiddenStorage = 'league-cloud-coach-hidden-kinds'
const commentsKey = 'comments'

type Item =
  | { id: string; type: 'event'; entry: TimelineEntry; sortMs: number }
  | { id: string; type: 'comment'; comment: ReviewComment; sortMs: number }

function loadHidden(): Set<string> {
  try {
    const saved = localStorage.getItem(hiddenStorage)
    if (saved !== null) return new Set(JSON.parse(saved))
  } catch {
    // Filters are a per-browser convenience.
  }
  return new Set<string>(['opponentItem'])
}

export function VideoReview({
  repository,
  league,
  recordedOn,
  renderPlayer,
}: {
  repository: ReviewRepository
  league?: LeagueRepository
  recordedOn?: string | null
  renderPlayer(onController: (controller: PlayerController | null) => void): ReactNode
}) {
  const owner = repository.role === 'owner'
  const [controller, setController] = useState<PlayerController | null>(null)
  const [data, setData] = useState<ReviewData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [composing, setComposing] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [hidden, setHidden] = useState(loadHidden)
  const [follow, setFollow] = useState(true)
  const list = useRef<HTMLOListElement>(null)

  const reload = useCallback(async () => {
    try {
      const next = await repository.load()
      setData(next)
      setState('ready')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the review timeline.')
      setState((s) => (s === 'loading' ? 'error' : s))
    }
  }, [repository])
  useEffect(() => {
    void reload()
    // Coaches and the player may review at the same time; pick up new comments.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, 20000)
    const focus = () => void reload()
    window.addEventListener('focus', focus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [reload])

  useEffect(() => {
    if (!controller) {
      setPlayheadMs(null)
      return
    }
    const tick = () => {
      const time = controller.currentTime()
      const duration = controller.duration()
      if (Number.isFinite(time)) setPlayheadMs(Math.round(time * 4) * 250)
      if (Number.isFinite(duration) && duration > 0) setDurationMs(Math.round(duration * 1000))
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [controller])

  const review = data?.review ?? null
  const anchor = data?.anchor ?? null
  const entries = useMemo(() => (review ? buildTimeline(review) : []), [review])
  const coverage = useMemo(
    () => (anchor && durationMs ? [gameTimeMs(anchor, 0), gameTimeMs(anchor, durationMs)] : null),
    [anchor, durationMs],
  )
  const comments = data?.comments ?? []
  const presentKinds = entryKinds.filter((k) => entries.some((e) => e.kind === k.kind))
  const items = useMemo(() => {
    const eventMs = (gameMs: number) =>
      anchor ? Math.round(videoOffset(anchor, gameMs / 1000) * 1000) : gameMs
    const events: Item[] = entries
      .filter((e) => filterKinds(e).some((k) => !hidden.has(k)))
      .map((entry) => ({ id: entry.id, type: 'event', entry, sortMs: eventMs(entry.gameTimeMs) }))
    const notes: Item[] = hidden.has(commentsKey)
      ? []
      : comments.map((comment) => ({
          id: comment.id,
          type: 'comment',
          comment,
          sortMs: comment.videoMs,
        }))
    return [...events, ...notes].sort((a, b) => a.sortMs - b.sortMs || (a.id < b.id ? -1 : 1))
  }, [entries, comments, hidden, anchor])
  const currentId = useMemo(() => {
    if (playheadMs === null) return null
    return items.filter((i) => i.sortMs <= playheadMs).at(-1)?.id ?? null
  }, [items, playheadMs])

  useEffect(() => {
    if (!follow || !currentId || !list.current || editing) return
    const row = list.current.querySelector<HTMLElement>(`[data-item="${currentId}"]`)
    if (!row) return
    const box = list.current
    const target = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    box.scrollTo?.({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' })
  }, [currentId, follow, editing])

  const seekGame = (gameMs: number, preRoll = true) => {
    if (!controller || !anchor || !coverage || gameMs < coverage[0] || gameMs > coverage[1]) return
    const target = preRoll ? Math.max(gameMs - eventPreRollMs, coverage[0]) : gameMs
    controller.seekTo(videoOffset(anchor, target / 1000))
  }
  const seekable = (gameMs: number) =>
    Boolean(controller && coverage && gameMs >= coverage[0] && gameMs <= coverage[1])
  const commentTime = (videoMs: number) =>
    anchor ? clock(gameTimeMs(anchor, videoMs)) : clock(videoMs)

  const startComment = useCallback(() => {
    if (!controller) return
    setEditing(null)
    setComposing(Math.max(0, Math.round(controller.currentTime() * 1000)))
  }, [controller])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== 'n' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable], dialog[open]')) return
      if (!controller || composing !== null) return
      event.preventDefault()
      startComment()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [controller, composing, startComment])

  async function act(work: () => Promise<unknown>) {
    setActionError('')
    try {
      await work()
      await reload()
      return true
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : 'That didn’t save. Please try again.',
      )
      return false
    }
  }
  function toggle(kind: string) {
    const next = new Set(hidden)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setHidden(next)
    try {
      localStorage.setItem(hiddenStorage, JSON.stringify([...next]))
    } catch {
      // Not persisted in this browser.
    }
  }
  const patch = review ? patchOf(review.gameVersion) : ''
  const filtered = presentKinds.some((k) => hidden.has(k.kind)) || hidden.has(commentsKey)
  const eventCount = items.filter((i) => i.type === 'event').length
  const commentCount = items.length - eventCount

  return (
    <div className="review-layout">
      <div className="review-video">{renderPlayer(setController)}</div>
      <section className="review-panel" aria-label="Review timeline">
        <header className="review-header">
          <div className="review-title">
            <h2>Timeline</h2>
            <span>
              {eventCount} {eventCount === 1 ? 'event' : 'events'} · {commentCount}{' '}
              {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>
          <div className="review-tools">
            {(presentKinds.length > 0 || comments.length > 0) && (
              <details className="review-filter">
                <summary
                  className={`icon-button ${filtered ? 'active' : ''}`}
                  aria-label="Filter timeline"
                  title="Filter timeline"
                >
                  <Filter size={15} />
                </summary>
                <div className="review-filter-menu">
                  {presentKinds.map((k) => (
                    <label key={k.kind}>
                      <input
                        type="checkbox"
                        checked={!hidden.has(k.kind)}
                        onChange={() => toggle(k.kind)}
                      />
                      <i className={`kind-dot kind-${k.kind}`} />
                      {k.name}
                      <small>{entries.filter((e) => e.kind === k.kind).length}</small>
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={!hidden.has(commentsKey)}
                      onChange={() => toggle(commentsKey)}
                    />
                    <i className="kind-dot kind-comment" />
                    Comments
                    <small>{comments.length}</small>
                  </label>
                </div>
              </details>
            )}
            <button
              className="button button-small"
              onClick={startComment}
              disabled={!controller || composing !== null}
              title={controller ? 'Comment at the playhead (N)' : 'Wait for the video to load'}
            >
              <MessageSquarePlus size={15} />
              Comment
            </button>
          </div>
        </header>
        <ClockStatus
          owner={owner}
          data={data}
          playerReady={Boolean(controller)}
          onSync={() => controller && setSyncing(Math.max(0, controller.currentTime()))}
          onAttach={() => setAttaching(true)}
        />
        {actionError && (
          <div className="notice error review-notice" role="alert">
            {actionError}
          </div>
        )}
        {composing !== null && (
          <Composer
            role={repository.role}
            timeLabel={commentTime(composing)}
            videoClock={!anchor}
            onCancel={() => setComposing(null)}
            onSave={async (kind, body, name) => {
              const ok = await act(() =>
                repository.addComment({ videoMs: composing, kind, body }, name),
              )
              if (ok) setComposing(null)
              return ok
            }}
          />
        )}
        {state === 'loading' ? (
          <div className="review-empty" role="status">
            <LoaderCircle className="spin" size={18} />
            Loading the timeline…
          </div>
        ) : state === 'error' ? (
          <div className="review-empty" role="alert">
            <p>{error}</p>
            <button className="button secondary button-small" onClick={() => void reload()}>
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="review-empty">
            {entries.length || comments.length ? (
              <>
                <p>Everything on this timeline is hidden by the filter.</p>
                <button
                  className="button secondary button-small"
                  onClick={() => {
                    setHidden(new Set(['opponentItem']))
                    try {
                      localStorage.removeItem(hiddenStorage)
                    } catch {
                      // Nothing saved.
                    }
                  }}
                >
                  Reset filter
                </button>
              </>
            ) : (
              <>
                <strong>No comments yet</strong>
                <p>
                  {owner
                    ? 'Add a comment or question at the playhead. Your coach sees it on the watch page and can reply with their own.'
                    : 'Add a comment at the playhead. The player sees it straight away.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="review-list-wrap">
            <ol
              className="review-list"
              ref={list}
              // The reader taking over the list stops it following the playhead.
              onWheel={() => playheadMs !== null && setFollow(false)}
              onTouchMove={() => playheadMs !== null && setFollow(false)}
              onKeyDown={(event) => {
                if (
                  ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(
                    event.key,
                  ) &&
                  playheadMs !== null
                )
                  setFollow(false)
              }}
            >
              {items.map((item) =>
                item.type === 'event' ? (
                  <EventRow
                    key={item.id}
                    entry={item.entry}
                    patch={patch}
                    current={item.id === currentId}
                    seekable={seekable(item.entry.gameTimeMs)}
                    dim={Boolean(coverage) && !seekable(item.entry.gameTimeMs)}
                    onSeek={() => seekGame(item.entry.gameTimeMs)}
                    onSeekTime={(ms) => seekGame(ms)}
                  />
                ) : editing === item.id ? (
                  <li key={item.id} className="timeline-row composing">
                    <Composer
                      role={repository.role}
                      timeLabel={commentTime(item.comment.videoMs)}
                      videoClock={!anchor}
                      initial={item.comment}
                      onCancel={() => setEditing(null)}
                      onSave={async (kind, body) => {
                        const ok = await act(() =>
                          repository.updateComment(item.id, { kind, body }),
                        )
                        if (ok) setEditing(null)
                        return ok
                      }}
                    />
                  </li>
                ) : (
                  <CommentRow
                    key={item.id}
                    comment={item.comment}
                    timeLabel={commentTime(item.comment.videoMs)}
                    videoClock={!anchor}
                    current={item.id === currentId}
                    viewer={repository.role}
                    onSeek={() =>
                      controller?.seekTo(
                        Math.max(0, item.comment.videoMs - commentPreRollMs) / 1000,
                      )
                    }
                    onEdit={
                      item.comment.mine
                        ? () => {
                            setComposing(null)
                            setEditing(item.id)
                          }
                        : undefined
                    }
                    onDelete={
                      item.comment.mine || owner
                        ? () => void act(() => repository.deleteComment(item.id))
                        : undefined
                    }
                  />
                ),
              )}
            </ol>
            {!follow && playheadMs !== null && (
              <button
                className="button secondary button-small review-follow"
                onClick={() => setFollow(true)}
              >
                <ArrowDownToLine size={14} />
                Return to playhead
              </button>
            )}
          </div>
        )}
      </section>
      {syncing !== null && repository.setAnchor && (
        <SyncClockDialog
          videoSeconds={syncing}
          anchor={anchor}
          onClose={() => setSyncing(null)}
          onSave={(next) => act(() => repository.setAnchor!(next))}
        />
      )}
      {attaching && league && repository.attachMatch && (
        <AttachMatchDialog
          league={league}
          recordedOn={recordedOn ?? null}
          attachedId={data?.matchId ?? null}
          onClose={() => setAttaching(false)}
          onAttach={(profile, match) => act(() => repository.attachMatch!(profile, match))}
          onDetach={() => act(() => repository.detachMatch!())}
        />
      )}
    </div>
  )
}

function ClockStatus({
  owner,
  data,
  playerReady,
  onSync,
  onAttach,
}: {
  owner: boolean
  data: ReviewData | null
  playerReady: boolean
  onSync(): void
  onAttach(): void
}) {
  if (!data) return null
  const review = data.review
  const me = review?.participants.find((p) => p.id === review.playerId)
  return (
    <div className="review-status">
      <div className="review-status-line">
        <Link2 size={14} aria-hidden="true" />
        {review && me ? (
          <span>
            {me.championName} · {queues[review.queueId] ?? 'Game'} ·{' '}
            {clock(review.gameDuration * 1000)}
          </span>
        ) : (
          <span>
            {owner
              ? 'Attach the game from your match history to add kills, fights and recalls.'
              : 'Game events will appear once the player attaches this game.'}
          </span>
        )}
        {owner && (
          <button className="button secondary button-small" onClick={onAttach}>
            {review ? 'Change game' : 'Attach game'}
          </button>
        )}
      </div>
      {review && (
        <div className="review-status-line">
          <Clock3 size={14} aria-hidden="true" />
          <span>
            {data.anchor
              ? `Game clock synced: ${clock(data.anchor.gameTimeSeconds * 1000)} at ${clock(data.anchor.videoOffsetSeconds * 1000)} in the video`
              : owner
                ? 'Sync the game clock so events jump to the right moment.'
                : "Events can't jump to the video until the player syncs the game clock."}
          </span>
          {owner && (
            <button
              className="button secondary button-small"
              onClick={onSync}
              disabled={!playerReady}
              title={
                playerReady
                  ? 'Read the in-game timer from the current frame'
                  : 'Wait for the video to load'
              }
            >
              {data.anchor ? 'Resync' : 'Sync clock'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Composer({
  role,
  timeLabel,
  videoClock,
  initial,
  onCancel,
  onSave,
}: {
  role: 'owner' | 'coach'
  timeLabel: string
  videoClock: boolean
  initial?: ReviewComment
  onCancel(): void
  onSave(kind: CommentKind, body: string, name?: string): Promise<boolean>
}) {
  const [kind, setKind] = useState<CommentKind>(initial?.kind ?? 'comment')
  const [body, setBody] = useState(initial?.body ?? '')
  const [name, setName] = useState(savedCoachName)
  const [askName, setAskName] = useState(() => !savedCoachName().trim())
  const [busy, setBusy] = useState(false)
  const group = useId()
  const needsName = role === 'coach' && !initial
  const prompt = commentKinds.find((k) => k.kind === kind)!.prompt
  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!body.trim() || (needsName && !name.trim()) || busy) return
    setBusy(true)
    if (needsName) saveCoachName(name.trim())
    const ok = await onSave(kind, body.trim(), needsName ? name.trim() : undefined)
    if (!ok) setBusy(false)
  }
  const kinds = role === 'owner' ? commentKinds : commentKinds.filter((k) => k.kind !== 'mindset')
  return (
    <form
      className="review-composer"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
      }}
    >
      <div className="composer-heading">
        <strong>
          {initial ? 'Edit' : 'New'} at {timeLabel}
        </strong>
        {videoClock && <small>video time</small>}
      </div>
      <div className="composer-kinds" role="radiogroup" aria-label="Comment type">
        {kinds.map((k) => (
          <label key={k.kind} className={kind === k.kind ? 'selected' : ''}>
            <input
              type="radio"
              name={group}
              checked={kind === k.kind}
              onChange={() => setKind(k.kind)}
            />
            {k.name}
          </label>
        ))}
      </div>
      {needsName &&
        (askName ? (
          <label className="composer-name">
            <span>Your name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shown with your comments"
            />
          </label>
        ) : (
          <p className="composer-as">
            Commenting as <strong>{name}</strong>
            <button type="button" className="text-link" onClick={() => setAskName(true)}>
              Change
            </button>
          </p>
        ))}
      <textarea
        aria-label="Comment text"
        value={body}
        maxLength={2000}
        rows={3}
        placeholder={prompt}
        autoFocus={!needsName || !askName}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="composer-actions">
        <small>⌘/Ctrl + Enter to save</small>
        <button type="button" className="button secondary button-small" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button button-small"
          disabled={busy || !body.trim() || (needsName && !name.trim())}
        >
          {busy ? 'Saving…' : initial ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  )
}

function SyncClockDialog({
  videoSeconds,
  anchor,
  onClose,
  onSave,
}: {
  videoSeconds: number
  anchor: ClockAnchor | null
  onClose(): void
  onSave(anchor: ClockAnchor | null): Promise<boolean>
}) {
  const mapped = anchor ? anchor.gameTimeSeconds + (videoSeconds - anchor.videoOffsetSeconds) : null
  const [text, setText] = useState(mapped !== null && mapped >= 0 ? clock(mapped * 1000) : '')
  const [busy, setBusy] = useState(false)
  const parsed = parseGameClock(text)
  const shift = parsed !== null && mapped !== null && mapped >= 0 ? parsed - mapped : null
  const hint = !text
    ? ' '
    : parsed === null
      ? 'Enter the clock as minutes:seconds, like 12:34.'
      : shift === null
        ? `Events will seek relative to ${clock(parsed * 1000)} at this frame.`
        : Math.abs(shift) < 0.5
          ? 'No change from the current sync.'
          : `Every event will land ${clock(Math.abs(shift) * 1000)} ${shift > 0 ? 'later' : 'earlier'} in the video than it does now.`
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (parsed === null) return
    setBusy(true)
    if (await onSave({ gameTimeSeconds: parsed, videoOffsetSeconds: videoSeconds })) onClose()
    else setBusy(false)
  }
  return (
    <Dialog title={anchor ? 'Resync game clock' : 'Sync game clock'} onClose={onClose}>
      <form className="sync-form" onSubmit={submit}>
        <p className="dialog-intro">
          Read the in-game timer at the top right of the current frame and enter it here. Every
          event seeks relative to this moment, for you and anyone you share the video with.
        </p>
        <dl className="sync-facts">
          <div>
            <dt>Video position</dt>
            <dd>{clock(videoSeconds * 1000)}</dd>
          </div>
          {mapped !== null && mapped >= 0 && (
            <div>
              <dt>Currently synced to</dt>
              <dd>{clock(mapped * 1000)}</dd>
            </div>
          )}
        </dl>
        <label className="form-label">
          <span>In-game clock</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="mm:ss"
            inputMode="decimal"
          />
        </label>
        <p className="field-hint" aria-live="polite">
          {hint}
        </p>
        <div className="form-footer">
          {anchor && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                if (await onSave(null)) onClose()
                else setBusy(false)
              }}
            >
              Clear sync
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy || parsed === null}>
            {busy ? 'Saving…' : anchor ? 'Resync' : 'Sync'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function AttachMatchDialog({
  league,
  recordedOn,
  attachedId,
  onClose,
  onAttach,
  onDetach,
}: {
  league: LeagueRepository
  recordedOn: string | null
  attachedId: string | null
  onClose(): void
  onAttach(profileId: string, matchId: string): Promise<boolean>
  onDetach(): Promise<boolean>
}) {
  const [profiles, setProfiles] = useState<LeagueProfile[] | null>(null)
  const [profileId, setProfileId] = useState('')
  const [games, setGames] = useState<Game[] | null>(null)
  const [selected, setSelected] = useState<string>(attachedId ?? '')
  const [busy, setBusy] = useState<'attach' | 'detach' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    league
      .profiles()
      .then((rows) => {
        setProfiles(rows)
        setProfileId(rows[0]?.id ?? '')
      })
      .catch((e: Error) => setError(e.message))
  }, [league])
  useEffect(() => {
    const profile = profiles?.find((p) => p.id === profileId)
    if (!profile) return
    let active = true
    setGames(null)
    league
      .matches(profile.id)
      .then((rows) => {
        if (!active) return
        const list = gamesFor(rows, profile.puuid).sort((a, b) => b.gameCreation - a.gameCreation)
        setGames(list)
        // Preselect the only game played on the recording's date.
        if (!attachedId && recordedOn) {
          const sameDay = list.filter((g) => localDate(g.gameCreation) === recordedOn)
          if (sameDay.length === 1) setSelected(sameDay[0].id)
        }
      })
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [league, profiles, profileId, attachedId, recordedOn])
  async function attach(event: FormEvent) {
    event.preventDefault()
    if (!selected || !profileId) return
    setBusy('attach')
    setError('')
    if (await onAttach(profileId, selected)) onClose()
    else setBusy(null)
  }
  return (
    <Dialog title={attachedId ? 'Change game' : 'Attach game'} onClose={onClose} wide>
      <form className="attach-form" onSubmit={attach}>
        <p className="dialog-intro">
          Pick the game this video shows. Its Riot timeline is fetched once with your token and
          saved with the video, so anyone you share it with sees the same events.
        </p>
        {error && <div className="notice error">{error}</div>}
        {profiles === null ? (
          <div className="review-empty" role="status">
            <LoaderCircle className="spin" size={18} />
            Loading your accounts…
          </div>
        ) : profiles.length === 0 ? (
          <div className="notice">
            Add your League account in Home and sync your match history first.
          </div>
        ) : (
          <>
            {profiles.length > 1 && (
              <label className="form-label">
                <span>Account</span>
                <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.gameName}#{p.tagLine}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {games === null ? (
              <div className="review-empty" role="status">
                <LoaderCircle className="spin" size={18} />
                Loading synced games…
              </div>
            ) : games.length === 0 ? (
              <div className="notice">
                No synced games yet. Refresh your match history in Home, then try again.
              </div>
            ) : (
              <fieldset className="attach-games">
                <legend className="sr-only">Game</legend>
                {games.slice(0, 40).map((g) => (
                  <label key={g.id} className={selected === g.id ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="game"
                      value={g.id}
                      checked={selected === g.id}
                      onChange={() => setSelected(g.id)}
                    />
                    <img src={championIcon(g.player.championId)} alt="" loading="lazy" />
                    <span>
                      <strong>
                        {g.player.championName}
                        {g.opponent && ` vs ${g.opponent.championName}`}
                      </strong>
                      <small>
                        {queues[g.queueId] ?? 'Game'} ·{' '}
                        {roleNames[g.player.teamPosition] ?? 'Any role'} ·{' '}
                        {new Date(g.gameCreation).toLocaleString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <span className={`attach-result ${g.player.win ? 'win' : 'loss'}`}>
                      {g.player.win ? 'Win' : 'Loss'} · {clock(g.gameDuration * 1000)}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        <div className="form-footer">
          {attachedId && (
            <button
              type="button"
              className="button secondary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('detach')
                if (await onDetach()) onClose()
                else setBusy(null)
              }}
            >
              {busy === 'detach' ? 'Removing…' : 'Remove game'}
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={!selected || busy !== null}>
            {busy === 'attach'
              ? 'Fetching timeline…'
              : attachedId === selected
                ? 'Refresh timeline'
                : 'Attach game'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function localDate(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
