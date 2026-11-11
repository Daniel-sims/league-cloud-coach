import { useEffect, useState, type MouseEvent, type ReactNode, type KeyboardEvent } from 'react'
import { MapPin, Pencil, Shield, Skull, Trash2, UserX, Zap } from 'lucide-react'
import { championIcon } from '../lib/league'
import {
  clock,
  seekLeadMs,
  type FightMoment,
  type FightCard,
  type ItemStack,
  type MatchupCard,
  type ObjectiveCard,
  type TimelineEntry,
} from '../lib/review-timeline'
import {
  commentKinds,
  type ReviewCapture,
  type ReviewComment,
  type ReviewRepository,
} from '../lib/review'
import { CaptureThumbnail } from './DrawingCapture'
import type { EventMenuTarget } from './EventContextMenu'

const itemNames = new Map<string, Promise<Record<string, string>>>()
/// Item names for tooltips; icons render without them while Data Dragon answers.
function useItemNames(patch: string) {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    if (!itemNames.has(patch))
      itemNames.set(
        patch,
        fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`)
          .then((r) => (r.ok ? r.json() : { data: {} }))
          .then((json: { data: Record<string, { name: string }> }) =>
            Object.fromEntries(
              Object.entries(json.data ?? {}).map(([id, item]) => [id, item.name]),
            ),
          )
          .catch(() => ({})),
      )
    itemNames.get(patch)!.then((value) => active && setNames(value))
    return () => {
      active = false
    }
  }, [patch])
  return names
}
/// The whole row seeks; buttons inside it do their own thing, and a click
/// that ends a text selection is reading, not seeking.
function rowClick(action: () => void) {
  return (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('button, a, input, textarea, label')) return
    if (window.getSelection()?.toString()) return
    action()
  }
}
export const patchOf = (gameVersion: string) => gameVersion.split('.').slice(0, 2).join('.') + '.1'

function Items({ stacks, patch }: { stacks: ItemStack[]; patch: string }) {
  const names = useItemNames(patch)
  return (
    <span className="timeline-items">
      {stacks.map(({ item, count }) => {
        const name = names[item] ?? `Item ${item}`
        return (
          <span key={item} className="timeline-item" title={count > 1 ? `${name} ×${count}` : name}>
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${item}.png`}
              alt={name}
              loading="lazy"
            />
            {count > 1 && <small>{count}</small>}
          </span>
        )
      })}
    </span>
  )
}

export function EventRow({
  entry,
  patch,
  current,
  seekable,
  dim,
  compact,
  onSeek,
  onSeekTime,
  onOpenMenu,
  children,
}: {
  entry: TimelineEntry
  patch: string
  current: boolean
  seekable: boolean
  dim: boolean
  compact?: boolean
  onSeek(): void
  onSeekTime(gameMs: number, kind?: FightMoment['kind']): void
  onOpenMenu?(target: EventMenuTarget): void
  children?: ReactNode
}) {
  const contextHandlers = {
    onContextMenu: (event: MouseEvent<HTMLLIElement>) => {
      if (
        !onOpenMenu ||
        (event.target instanceof Element && event.target.closest('.event-discussion'))
      )
        return
      event.preventDefault()
      event.stopPropagation()
      onOpenMenu({
        x: event.clientX,
        y: event.clientY,
        origin: event.currentTarget.querySelector('button'),
      })
    },
    onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
      if (
        !onOpenMenu ||
        (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) ||
        (event.target instanceof Element && event.target.closest('.event-discussion'))
      )
        return
      event.preventDefault()
      event.stopPropagation()
      const origin = event.currentTarget.querySelector('button')
      const box = origin?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect()
      onOpenMenu({ x: box.left, y: box.bottom, origin })
    },
  }
  if (compact) {
    const Icon = entry.kind === 'death' ? Skull : Zap
    return (
      <li
        {...contextHandlers}
        className={`timeline-row timeline-compact kind-${entry.kind} ${current ? 'current' : ''} ${dim ? 'dim' : ''} ${seekable ? 'clickable' : ''}`}
        data-item={entry.id}
        onClick={seekable ? rowClick(onSeek) : undefined}
      >
        <span className="timeline-time">{clock(entry.gameTimeMs)}</span>
        <span className="timeline-spine" aria-hidden="true">
          <i />
        </span>
        <div className="timeline-body">
          <button
            className="timeline-compact-play"
            onClick={onSeek}
            disabled={!seekable}
            aria-label={`${entry.label} at ${clock(entry.gameTimeMs)}`}
            title={entry.detail ? `${entry.label} · ${entry.detail}` : entry.label}
            aria-keyshortcuts="Shift+F10"
            aria-description="Right-click or press Shift+F10 to add a comment."
          >
            <span
              className={`timeline-icon ${entry.objective ? (entry.objective.mine ? 'objective-ours' : 'objective-theirs') : ''}`}
            >
              {entry.objective ? (
                <img
                  src={`${import.meta.env.BASE_URL}objectives/${entry.objective.icon}.png`}
                  alt=""
                />
              ) : (
                <Icon size={15} aria-hidden="true" />
              )}
            </span>
            <span className="timeline-play-name">{entry.objective?.name ?? entry.label}</span>
          </button>
          {children}
        </div>
      </li>
    )
  }
  return (
    <li
      {...contextHandlers}
      className={`timeline-row kind-${entry.kind} ${current ? 'current' : ''} ${dim ? 'dim' : ''} ${seekable ? 'clickable' : ''}`}
      data-item={entry.id}
      onClick={seekable ? rowClick(onSeek) : undefined}
    >
      <span className="timeline-time">{clock(entry.gameTimeMs)}</span>
      <span className="timeline-spine" aria-hidden="true">
        <i />
      </span>
      <div className="timeline-body">
        <button
          className="timeline-label"
          aria-keyshortcuts="Shift+F10"
          aria-description="Right-click or press Shift+F10 to add a comment."
          onClick={onSeek}
          disabled={!seekable}
          title={
            seekable
              ? seekLeadMs(entry.kind)
                ? 'Watch from 5 seconds before'
                : 'Watch this moment'
              : dim
                ? "The recording doesn't cover this moment"
                : undefined
          }
        >
          {entry.label}
        </button>
        {entry.matchup ? (
          <Matchup card={entry.matchup} />
        ) : entry.objective ? (
          <Objective card={entry.objective} />
        ) : (
          <>
            {entry.items && entry.items.length > 0 && <Items stacks={entry.items} patch={patch} />}
            {entry.inventoryAfter && entry.inventoryAfter.length > 0 && (
              <span className="timeline-inventory">
                <small>Build after</small>
                <Items stacks={entry.inventoryAfter} patch={patch} />
              </span>
            )}
            {entry.detail && <p className="timeline-detail">{entry.detail}</p>}
            {entry.fight && (
              <Fight card={entry.fight} seekable={seekable} onSeekTime={onSeekTime} />
            )}
            {entry.sections?.map((s) => (
              <div className="timeline-card" key={s.title}>
                <small>{s.title}</small>
                <p>{s.body}</p>
              </div>
            ))}
          </>
        )}
        {children}
      </div>
    </li>
  )
}

function Fight({
  card,
  seekable,
  onSeekTime,
}: {
  card: FightCard
  seekable: boolean
  onSeekTime(gameMs: number, kind?: FightMoment['kind']): void
}) {
  const outcome = { won: 'Won', lost: 'Lost', traded: 'Traded' }[card.outcome]
  return (
    <div className="timeline-card fight-card">
      <div className="fight-heading">
        <span>
          <MapPin size={13} aria-hidden="true" />
          {card.location}
        </span>
        <span className={`fight-outcome ${card.outcome}`}>
          {outcome} {card.enemyDeaths}–{card.alliedDeaths}
        </span>
      </div>
      <div className="fight-teams">
        {(
          [
            ['Your team', card.allies],
            ['Their team', card.enemies],
          ] as const
        ).map(([title, people]) => (
          <div key={title}>
            <small>{title}</small>
            <span>
              {people.map((x) => (
                <span
                  key={x.id}
                  className={`fight-champion ${x.died ? 'died' : ''} ${x.isPlayer ? 'player' : ''}`}
                  title={`${x.championName}${x.isPlayer ? ' (you)' : ''} · ${x.kills} kills, ${x.assists} assists${x.died ? ', died' : ''}`}
                >
                  {x.championId ? (
                    <img src={championIcon(x.championId)} alt={x.championName} loading="lazy" />
                  ) : (
                    x.championName
                  )}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      {card.turretCallout && (
        <p className="fight-turret">
          <Shield size={13} aria-hidden="true" />
          {card.turretCallout}
        </p>
      )}
      {card.moments ? (
        <ul className="fight-moments">
          {card.moments.map((m) => (
            <li key={`${m.t}-${m.label}`} className={m.kind}>
              <button disabled={!seekable} onClick={() => onSeekTime(m.t, m.kind)}>
                <span>{clock(m.t)}</span>
                {m.label}
              </button>
              {m.detail && <small>{m.detail}</small>}
            </li>
          ))}
        </ul>
      ) : card.absence?.seekMs !== undefined ? (
        <button
          className="fight-absence"
          disabled={!seekable}
          onClick={() => onSeekTime(card.absence!.seekMs!)}
        >
          <UserX size={13} aria-hidden="true" />
          {card.absence.label}
        </button>
      ) : (
        <p className="fight-absence">
          <UserX size={13} aria-hidden="true" />
          {card.absence?.label ?? "You weren't credited in this fight"}
        </p>
      )}
    </div>
  )
}

function Objective({ card }: { card: ObjectiveCard }) {
  const base = import.meta.env.BASE_URL
  const who = (p: NonNullable<ObjectiveCard['killer']>) => (
    <span
      key={`${p.name}-${p.isPlayer}`}
      className={`fight-champion ${p.isPlayer ? 'player' : ''}`}
      title={p.name + (p.isPlayer ? ' (you)' : '')}
    >
      {p.championId ? <img src={championIcon(p.championId)} alt={p.name} loading="lazy" /> : p.name}
    </span>
  )
  return (
    <div className={`timeline-card objective-card ${card.mine ? 'ours' : 'theirs'}`}>
      <img className="objective-icon" src={`${base}objectives/${card.icon}.png`} alt="" />
      <div className="objective-text">
        <strong>{card.name}</strong>
        <small>{card.mine ? 'Your team' : 'Enemy team'}</small>
        {card.tally && <span className="objective-tally">{card.tally}</span>}
      </div>
      {(card.killer || card.assists.length > 0) && (
        <div className="objective-people">
          {card.killer && (
            <span>
              <small>Secured</small>
              {who(card.killer)}
            </span>
          )}
          {card.assists.length > 0 && (
            <span>
              <small>Assists</small>
              {card.assists.map(who)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/// You on the left, your lane opponent mirrored on the right; each stat's
/// name and difference sit between the two values.
function Matchup({ card }: { card: MatchupCard }) {
  const { player: me, opponent: them } = card
  const number = (value: number) => value.toLocaleString('en-GB')
  const signed = (value: number) =>
    value > 0 ? `+${number(value)}` : value < 0 ? `−${number(-value)}` : 'Even'
  const tone = (value: number) => (value > 0 ? 'ahead' : value < 0 ? 'behind' : 'even')
  const rows: [string, number, number][] = [
    ['Gold', me.gold, them.gold],
    ['CS', me.cs, them.cs],
    ...(me.xp !== undefined && them.xp !== undefined
      ? [['XP', me.xp, them.xp] as [string, number, number]]
      : []),
  ]
  const side = (who: typeof me, mirrored: boolean) => (
    <div className={`vs-side ${mirrored ? 'mirrored' : ''}`}>
      {who.championId && <img src={championIcon(who.championId)} alt="" loading="lazy" />}
      <span>
        <strong>{who.name}</strong>
        <small>
          {who.kda.join(' / ')}
          {who.level ? ` · Lv ${who.level}` : ''}
        </small>
      </span>
    </div>
  )
  return (
    <div className="timeline-card matchup-card">
      <div className="vs-heading">
        {side(me, false)}
        <span className="vs-word">vs</span>
        {side(them, true)}
      </div>
      <dl className="vs-stats">
        {rows.map(([label, mine, theirs]) => {
          const diff = mine - theirs
          return (
            <div key={label} className="vs-row">
              <dd className={`vs-value ${diff > 0 ? 'leads' : ''}`}>{number(mine)}</dd>
              <dt>
                <span>{label}</span>
                <b className={tone(diff)}>{signed(diff)}</b>
              </dt>
              <dd className={`vs-value theirs ${diff < 0 ? 'leads' : ''}`}>{number(theirs)}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

export function CommentRow({
  comment,
  timeLabel,
  videoClock,
  current,
  viewer,
  onSeek,
  onEdit,
  onDelete,
  nested = false,
}: {
  comment: ReviewComment
  timeLabel: string
  videoClock: boolean
  current: boolean
  viewer: 'owner' | 'coach'
  onSeek(): void
  onEdit?(): void
  onDelete?(): void
  nested?: boolean
}) {
  const kind = commentKinds.find((k) => k.kind === comment.kind)!
  const [asking, setAsking] = useState(false)
  const author = comment.mine
    ? 'You'
    : comment.role === 'owner'
      ? 'Player'
      : comment.author || 'Coach'
  return (
    <li
      onClick={rowClick(onSeek)}
      className={`${nested ? 'event-comment' : 'timeline-row'} comment clickable comment-${comment.kind} ${current ? 'current' : ''}`}
      data-item={comment.id}
    >
      {!nested && (
        <span className="timeline-time" title={videoClock ? 'Video time' : 'Game time'}>
          {timeLabel}
          {videoClock && <small>video</small>}
        </span>
      )}
      {!nested && (
        <span className="timeline-spine" aria-hidden="true">
          <i />
        </span>
      )}
      <div className="timeline-body comment-body">
        {!nested && comment.event && (
          <p className="comment-event-context">
            On {comment.event.label} · {clock(comment.event.gameMs)}
          </p>
        )}
        <div className="comment-meta">
          <span className="comment-kind">{kind.name}</span>
          <span className={`comment-author ${comment.role}`}>{author}</span>
          {viewer === 'owner' && comment.role === 'coach' && (
            <span className="comment-role">Coach</span>
          )}
          <span className="comment-actions">
            {onEdit && (
              <button
                className="icon-button"
                aria-label="Edit comment"
                title="Edit"
                onClick={onEdit}
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                className="icon-button"
                aria-label="Delete comment"
                title="Delete"
                onClick={() => setAsking(true)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </span>
        </div>
        {asking && onDelete && (
          <div className="comment-confirm" role="group" aria-label="Confirm delete">
            <span>Delete this comment for everyone?</span>
            <button className="button danger button-small" onClick={onDelete}>
              Delete
            </button>
            <button className="button secondary button-small" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        )}
        <button className="comment-text" onClick={onSeek} title="Watch this moment">
          {comment.body}
        </button>
      </div>
    </li>
  )
}

export function CaptureRow({
  capture,
  repository,
  timeLabel,
  videoClock,
  current,
  onOpen,
}: {
  capture: ReviewCapture
  repository: ReviewRepository
  timeLabel: string
  videoClock: boolean
  current: boolean
  onOpen(): void
}) {
  const author = capture.role === 'owner' ? 'Player' : capture.author || 'Coach'
  return (
    <li
      onClick={rowClick(onOpen)}
      className={`timeline-row kind-capture clickable ${current ? 'current' : ''}`}
      data-item={capture.id}
    >
      <span className="timeline-time" title={videoClock ? 'Video time' : 'Game time'}>
        {timeLabel}
        {videoClock && <small>video</small>}
      </span>
      <span className="timeline-spine" aria-hidden="true">
        <i />
      </span>
      <div className="timeline-body">
        <button className="timeline-label" onClick={onOpen} title="Open this drawing">
          Drawing capture
        </button>
        <button className="capture-open" onClick={onOpen} aria-label="Open drawing capture">
          <CaptureThumbnail capture={capture} repository={repository} />
          <span>
            {capture.body && <span>{capture.body}</span>}
            <small>{author}</small>
          </span>
        </button>
      </div>
    </li>
  )
}
