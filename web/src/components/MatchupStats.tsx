import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { MatchRow, Select } from './LeagueParts'
import type { LeagueRepository } from '../lib/league-repository'
import {
  kda,
  number,
  percent,
  queues,
  remake,
  type Game,
  type LeagueProfile,
  type Participant,
} from '../lib/league'
import { championLabel } from '../lib/champions'
import {
  frameMinute,
  frameValue,
  headToHead,
  laneAt,
  laneCurve,
  matchupGames,
  type CurvePoint,
  type LaneMetric,
  type Lanes,
  type MatchupRepository,
} from '../lib/matchups'
import type { OwnGame } from './Matchups'

const metricNames: Record<LaneMetric, string> = { gold: 'Gold', cs: 'CS', xp: 'XP' }
const signed = (value: number | null, digits = 0) =>
  value === null
    ? '—'
    : `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), digits)}`
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const dateLabel = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function MatchupStats({
  games,
  loading,
  championId,
  opponentId,
  championName,
  opponentName,
  profiles,
  league,
  repository,
  onSynced,
}: {
  games: OwnGame[]
  loading: boolean
  championId: number
  opponentId: number
  championName: string
  opponentName: string
  profiles: LeagueProfile[]
  league: LeagueRepository
  repository: MatchupRepository
  onSynced: () => void
}) {
  const [anyChampion, setAnyChampion] = useState(false)
  const [queue, setQueue] = useState('')
  const [metric, setMetric] = useState<LaneMetric>('gold')
  const [fullGame, setFullGame] = useState(false)
  const [lanes, setLanes] = useState<Lanes | null>(null)
  const [laneVersion, setLaneVersion] = useState(0)
  const [fetching, setFetching] = useState('')
  const [fetchNote, setFetchNote] = useState('')
  // Games already asked for: Riot keeps timelines for a limited time, so some never arrive.
  const [attempted, setAttempted] = useState<Set<string>>(() => new Set())

  const scoped = useMemo(
    () => matchupGames(games, opponentId, anyChampion ? null : championId),
    [games, opponentId, championId, anyChampion],
  )
  const queueIds = [...new Set(scoped.map((g) => g.queueId))].sort((a, b) => a - b)
  const shown = queue ? scoped.filter((g) => String(g.queueId) === queue) : scoped
  const decided = shown.filter((g) => !remake(g))
  const ids = scoped.map((g) => g.id).join(',')

  useEffect(() => {
    let active = true
    if (!scoped.length) {
      setLanes({})
      return
    }
    repository
      .lanes(scoped.map((g) => g.id))
      .then((result) => active && setLanes(result ?? {}))
      .catch(() => active && setLanes({}))
    return () => {
      active = false
    }
  }, [ids, repository, laneVersion])

  const withLane = decided.filter((g) => lanes?.[g.id]?.length)
  const missing = decided.filter((g) => lanes && !lanes[g.id]?.length)
  const fetchable = missing.filter((g) => !attempted.has(g.id))

  // Ask Riot for the timelines of games that don't have one yet, one game at a time.
  async function fetchTimelines() {
    const todo = missing.filter((g) => !attempted.has(g.id)).slice(0, 15)
    setFetchNote('')
    try {
      for (let i = 0; i < todo.length; i++) {
        setFetching(`Fetching timelines ${i + 1} of ${todo.length}…`)
        const at = Math.floor(todo[i].gameCreation / 1000)
        await league.syncTimelines(todo[i].profileId, { startTime: at - 1, endTime: at + 2 })
        setAttempted((old) => new Set(old).add(todo[i].id))
      }
      setLaneVersion((v) => v + 1)
      if (missing.filter((g) => !attempted.has(g.id)).length > todo.length)
        setFetchNote(`Fetched ${todo.length}. Run again for the rest.`)
      onSynced()
    } catch (e) {
      setFetchNote((e as Error).message)
      setLaneVersion((v) => v + 1)
    } finally {
      setFetching('')
    }
  }

  if (loading && !games.length)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" />
        Loading your games…
      </div>
    )

  const wins = decided.filter((g) => g.player.win).length
  const lane = (minute: number, m: LaneMetric) =>
    withLane.flatMap((g) => laneAt(lanes![g.id], minute, m) ?? [])
  const gold15 = lane(15, 'gold')
  const cs10 = lane(10, 'cs')
  const yourKda = decided.length
    ? decided.reduce((n, g) => n + g.player.kills + g.player.assists, 0) /
      Math.max(
        1,
        decided.reduce((n, g) => n + g.player.deaths, 0),
      )
    : null
  const theirKda = decided.length
    ? decided.reduce((n, g) => n + g.opponent!.kills + g.opponent!.assists, 0) /
      Math.max(
        1,
        decided.reduce((n, g) => n + g.opponent!.deaths, 0),
      )
    : null
  const lastMinute = withLane.length
    ? Math.max(...withLane.map((g) => Math.round(lanes![g.id].at(-1)![0] / 60)))
    : 0
  const maxMinute = fullGame ? Math.min(45, Math.max(lastMinute, 15)) : 15

  const filters = (
    <div className="matchup-filters">
      <div className="segmented" role="group" aria-label="Your champion">
        <button aria-pressed={!anyChampion} onClick={() => setAnyChampion(false)}>
          As {championName}
        </button>
        <button aria-pressed={anyChampion} onClick={() => setAnyChampion(true)}>
          Any champion
        </button>
      </div>
      <Select compact label="Queue" value={queue} onChange={setQueue}>
        <option value="">All queues</option>
        {queueIds.map((id) => (
          <option key={id} value={id}>
            {queues[id] || `Queue ${id}`}
          </option>
        ))}
      </Select>
    </div>
  )

  if (!shown.length)
    return (
      <div className="matchup-stats">
        {filters}
        <div className="league-card league-empty">
          <h3>
            No {anyChampion ? '' : `${championName} `}games against {opponentName} yet
          </h3>
          <p>
            {anyChampion || !matchupGames(games, opponentId, null).length
              ? 'Games appear here once they’re synced on Home.'
              : `You have games against ${opponentName} on other champions.`}
          </p>
          {!anyChampion && matchupGames(games, opponentId, null).length > 0 && (
            <button className="button secondary" onClick={() => setAnyChampion(true)}>
              Show any champion vs {opponentName}
            </button>
          )}
        </div>
      </div>
    )

  const ownPuuids = new Set(profiles.map((p) => p.puuid))
  const openPlayer = (game: OwnGame) => (player: Participant) => {
    if (ownPuuids.has(player.puuid)) {
      window.location.hash = '/home'
      return
    }
    const platform = profiles.find((p) => p.id === game.profileId)?.platform
    if (platform) window.location.hash = `/summoners/${platform}/${player.puuid}`
  }

  return (
    <div className="matchup-stats">
      {filters}
      <div className="matchup-tiles">
        <Tile
          label="Win rate"
          value={percent(decided.length ? wins / decided.length : null)}
          detail={`${wins}W ${decided.length - wins}L · ${decided.length} ${decided.length === 1 ? 'game' : 'games'}`}
          hero
        >
          <span
            className="matchup-form"
            role="img"
            aria-label={`Last ${Math.min(5, decided.length)} results, newest first: ${decided
              .slice(0, 5)
              .map((g) => (g.player.win ? 'win' : 'loss'))
              .join(', ')}`}
          >
            {decided.slice(0, 5).map((g) => (
              <span key={g.id} className={`league-result ${g.player.win ? 'win' : 'loss'}`}>
                {g.player.win ? 'W' : 'L'}
              </span>
            ))}
          </span>
        </Tile>
        <Tile
          label="Gold difference at 15"
          value={signed(mean(gold15))}
          detail={
            gold15.length
              ? `Ahead in ${gold15.filter((v) => v > 0).length} of ${gold15.length}`
              : lanes
                ? 'Needs game timelines'
                : 'Loading…'
          }
        />
        <Tile
          label="CS difference at 10"
          value={signed(mean(cs10), 1)}
          detail={
            cs10.length
              ? `Ahead in ${cs10.filter((v) => v > 0).length} of ${cs10.length}`
              : lanes
                ? 'Needs game timelines'
                : 'Loading…'
          }
        />
        <Tile
          label="KDA"
          value={yourKda === null ? '—' : number(yourKda, 2)}
          detail={theirKda === null ? '' : `${opponentName}: ${number(theirKda, 2)}`}
        />
      </div>
      {decided.length > 0 && decided.length < 5 && (
        <p className="muted matchup-sample">
          Only {decided.length} {decided.length === 1 ? 'game' : 'games'}: read these as hints, not
          trends.
        </p>
      )}

      <div className="league-section-heading">
        <h2>Lane</h2>
        <div className="matchup-chart-controls">
          <div className="segmented" role="group" aria-label="Lane measure">
            {(Object.keys(metricNames) as LaneMetric[]).map((m) => (
              <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                {metricNames[m]}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Time range">
            <button aria-pressed={!fullGame} onClick={() => setFullGame(false)}>
              First 15 min
            </button>
            <button aria-pressed={fullGame} onClick={() => setFullGame(true)}>
              Full game
            </button>
          </div>
        </div>
      </div>
      {!lanes ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Loading lane data…
        </div>
      ) : (
        <>
          {withLane.length > 0 ? (
            <section
              className="league-card matchup-chart-card"
              aria-label="Lane difference by minute"
            >
              <h3>
                {metricNames[metric]} difference by minute
                <small>You minus {opponentName}, averaged across games</small>
              </h3>
              <LaneChart
                points={laneCurve(withLane, lanes, metric, maxMinute)}
                games={withLane.map((g) => ({
                  id: g.id,
                  win: g.player.win,
                  values: lanes[g.id]
                    .filter((f) => frameMinute(f) <= maxMinute)
                    .map((f) => [frameMinute(f), frameValue(f, metric)] as const),
                }))}
                maxMinute={maxMinute}
                metric={metric}
              />
            </section>
          ) : null}
          <section className="league-card matchup-chart-card" aria-label="Game by game">
            <h3>
              {metricNames[metric]} difference at 15 min, game by game
              <small>Oldest to newest</small>
            </h3>
            <GameBars
              games={[...decided].reverse().slice(-40)}
              value={(g) => (lanes[g.id] ? laneAt(lanes[g.id], 15, metric) : null)}
              metric={metric}
              anyChampion={anyChampion}
            />
          </section>
          {missing.length > 0 && (
            <div className="matchup-coverage">
              <span className="muted">
                Lane charts use {withLane.length} of {decided.length} games.{' '}
                {fetchable.length
                  ? `${fetchable.length} ${fetchable.length === 1 ? 'has' : 'have'} no timeline saved yet.`
                  : `Riot has no timeline for the other ${missing.length}.`}
              </span>
              {fetchable.length > 0 && (
                <button
                  className="button secondary button-small"
                  disabled={Boolean(fetching)}
                  onClick={() => void fetchTimelines()}
                >
                  <RefreshCw size={13} className={fetching ? 'spin' : ''} />
                  {fetching || 'Fetch timelines'}
                </button>
              )}
              {fetchNote && <span className="muted">{fetchNote}</span>}
            </div>
          )}
        </>
      )}

      <div className="league-section-heading">
        <h2>Head to head</h2>
        <span className="muted">Your average vs {opponentName}’s, per game</span>
      </div>
      <section className="league-card matchup-h2h" aria-label="Head to head">
        <div className="matchup-h2h-legend" aria-hidden>
          <span>
            <i className="you" /> You
          </span>
          <span>
            <i className="them" /> {opponentName}
          </span>
        </div>
        {headToHead(decided).map((row) => {
          const total = row.you + row.them
          const share = total ? row.you / total : 0.5
          const youBetter = row.lowerIsBetter ? row.you < row.them : row.you > row.them
          const themBetter = row.lowerIsBetter ? row.them < row.you : row.them > row.you
          return (
            <div className="matchup-h2h-row" key={row.key}>
              <strong className={youBetter ? 'better' : ''}>{number(row.you, row.digits)}</strong>
              <span>{row.label}</span>
              <strong className={themBetter ? 'better' : ''}>{number(row.them, row.digits)}</strong>
              <div
                className="matchup-h2h-bar"
                role="img"
                aria-label={`${row.label}: you ${number(row.you, row.digits)}, ${opponentName} ${number(row.them, row.digits)}`}
              >
                <span className="you" style={{ flexGrow: share }} />
                <span className="them" style={{ flexGrow: 1 - share }} />
              </div>
            </div>
          )
        })}
      </section>

      <details className="matchup-table">
        <summary>Show the numbers as a table</summary>
        <div className="matchup-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {anyChampion && <th scope="col">Champion</th>}
                <th scope="col">Result</th>
                <th scope="col">K/D/A</th>
                <th scope="col">Gold @10</th>
                <th scope="col">Gold @15</th>
                <th scope="col">CS @10</th>
                <th scope="col">CS @15</th>
                <th scope="col">XP @10</th>
                <th scope="col">Gold at end</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((g) => {
                const f = lanes?.[g.id]
                return (
                  <tr key={g.id}>
                    <td>{dateLabel(g.gameCreation)}</td>
                    {anyChampion && <td>{championLabel(g.player.championName)}</td>}
                    <td>{g.player.win ? 'Win' : 'Loss'}</td>
                    <td>
                      {g.player.kills}/{g.player.deaths}/{g.player.assists}
                    </td>
                    <td>{signed(laneAt(f, 10, 'gold'))}</td>
                    <td>{signed(laneAt(f, 15, 'gold'))}</td>
                    <td>{signed(laneAt(f, 10, 'cs'))}</td>
                    <td>{signed(laneAt(f, 15, 'cs'))}</td>
                    <td>{signed(laneAt(f, 10, 'xp'))}</td>
                    <td>{signed(g.player.goldEarned - g.opponent!.goldEarned)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      <div className="league-section-heading">
        <h2>Games</h2>
        <span className="muted">
          {shown.length} {shown.length === 1 ? 'game' : 'games'}
        </span>
      </div>
      <section className="league-card league-history" aria-label="Matchup games">
        {shown.map((g) => (
          <MatchRow
            key={g.id}
            game={g}
            onOpenPlayer={openPlayer(g)}
            busy={false}
            loadRanks={league.matchRanks}
          />
        ))}
      </section>
    </div>
  )
}

function Tile({
  label,
  value,
  detail,
  hero = false,
  children,
}: {
  label: string
  value: ReactNode
  detail: ReactNode
  hero?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`matchup-tile ${hero ? 'hero' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {children}
    </div>
  )
}

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// Clean axis steps: 1, 2 or 5 times a power of ten.
function niceTicks(min: number, max: number, count = 4) {
  const span = Math.max(max - min, 1)
  const raw = span / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000)
  return { ticks, lo, hi }
}
const tickLabel = (v: number) => (Math.abs(v) >= 10000 ? `${signed(v / 1000)}K` : signed(v))

type Tip = { x: number; y: number; content: ReactNode } | null
function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
}

const H = 260
const M = { l: 52, r: 64, t: 16, b: 28 }

function LaneChart({
  points,
  games,
  maxMinute,
  metric,
}: {
  points: CurvePoint[]
  games: { id: string; win: boolean; values: (readonly [number, number])[] }[]
  maxMinute: number
  metric: LaneMetric
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const plotW = Math.max(width - M.l - M.r, 100)
  const x = (m: number) => M.l + (m / Math.max(maxMinute, 1)) * plotW
  const all = [
    0,
    ...games.flatMap((g) => g.values.map(([, v]) => v)),
    ...points.flatMap((p) => [p.all, p.wins, p.losses].filter((v): v is number => v !== null)),
  ]
  const { ticks, lo, hi } = niceTicks(Math.min(...all), Math.max(...all))
  const y = (v: number) => M.t + ((hi - v) / (hi - lo || 1)) * (H - M.t - M.b)
  const path = (values: (readonly [number, number | null])[]) =>
    values
      .filter((p): p is readonly [number, number] => p[1] !== null)
      .map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`)
      .join('')
  const series = [
    { key: 'all', name: 'All games', className: 'all' },
    { key: 'wins', name: 'Wins', className: 'win' },
    { key: 'losses', name: 'Losses', className: 'loss' },
  ] as const
  const shownSeries = series.filter((s) => points.some((p) => p[s.key] !== null))
  // Direct end labels only where they don't collide; the legend always names every line.
  const placed: number[] = []
  const endLabels = shownSeries.flatMap((s) => {
    const last = [...points].reverse().find((p) => p[s.key] !== null)
    if (!last) return []
    const ly = y(last[s.key]!)
    if (placed.some((p) => Math.abs(p - ly) < 13)) return []
    placed.push(ly)
    return [{ ...s, x: x(last.minute), y: ly }]
  })
  const xTicks = Array.from({ length: Math.floor(maxMinute / 5) + 1 }, (_, i) => i * 5)
  const active = hover === null ? null : points[hover]
  const digits = metric === 'cs' ? 1 : 0
  const move = (clientX: number, rect: DOMRect) => {
    const m = Math.round(((clientX - rect.left - M.l) / plotW) * maxMinute)
    setHover(Math.max(0, Math.min(maxMinute, m)))
  }
  return (
    <div className="chart" ref={ref}>
      <div className="chart-legend" aria-hidden>
        {shownSeries.map((s) => (
          <span key={s.key}>
            <i className={`line-key ${s.className}`} />
            {s.name}
          </span>
        ))}
        <span>
          <i className="line-key faint" />
          Each game
        </span>
      </div>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`${metricNames[metric]} difference by minute. ${points
          .filter((p) => p.minute % 5 === 0 && p.all !== null)
          .map((p) => `Minute ${p.minute}: ${signed(p.all, digits)}`)
          .join('. ')}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? 'chart-zero' : 'chart-grid'}
              x1={M.l}
              x2={width - M.r}
              y1={y(t)}
              y2={y(t)}
            />
            <text className="chart-tick" x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        <text className="chart-region" x={M.l + 6} y={M.t + 10}>
          Ahead
        </text>
        <text className="chart-region" x={M.l + 6} y={H - M.b - 6}>
          Behind
        </text>
        {xTicks.map((m) => (
          <text key={m} className="chart-tick" x={x(m)} y={H - 8} textAnchor="middle">
            {m}′
          </text>
        ))}
        {games.map((g) => (
          <path key={g.id} className={`chart-faint ${g.win ? 'win' : 'loss'}`} d={path(g.values)} />
        ))}
        {shownSeries.map((s) => (
          <path
            key={s.key}
            className={`chart-line ${s.className}`}
            d={path(points.map((p) => [p.minute, p[s.key]] as const))}
          />
        ))}
        {endLabels.map((l) => (
          <text key={l.key} className="chart-end-label" x={l.x + 8} y={l.y} dy="0.32em">
            {l.name}
          </text>
        ))}
        {active && (
          <g>
            <line
              className="chart-crosshair"
              x1={x(active.minute)}
              x2={x(active.minute)}
              y1={M.t}
              y2={H - M.b}
            />
            {shownSeries.map((s) =>
              active[s.key] === null ? null : (
                <circle
                  key={s.key}
                  className={`chart-dot ${s.className}`}
                  cx={x(active.minute)}
                  cy={y(active[s.key]!)}
                  r={4}
                />
              ),
            )}
          </g>
        )}
        <rect
          className="chart-hit"
          x={M.l}
          y={M.t}
          width={plotW}
          height={H - M.t - M.b}
          tabIndex={0}
          aria-label="Explore by minute with the arrow keys"
          onPointerMove={(e) =>
            move(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())
          }
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? Math.min(10, maxMinute))}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault()
              const step = e.key === 'ArrowRight' ? 1 : -1
              setHover((h) => Math.max(0, Math.min(maxMinute, (h ?? 0) + step)))
            }
          }}
        />
      </svg>
      <Tooltip
        tip={
          active && {
            x: Math.min(x(active.minute) + 12, width - 170),
            y: M.t,
            content: (
              <>
                <small>
                  Minute {active.minute} · {active.count} {active.count === 1 ? 'game' : 'games'}
                </small>
                {shownSeries.map((s) => (
                  <span key={s.key}>
                    <i className={`line-key ${s.className}`} />
                    <strong>{signed(active[s.key], digits)}</strong>
                    {s.name}
                  </span>
                ))}
              </>
            ),
          }
        }
      />
    </div>
  )
}

function GameBars({
  games,
  value,
  metric,
  anyChampion,
}: {
  games: Game[]
  value: (g: Game) => number | null
  metric: LaneMetric
  anyChampion: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const h = 200,
    m = { l: 52, r: 16, t: 12, b: 26 }
  const plotW = Math.max(width - m.l - m.r, 100)
  const values = games.map(value)
  const known = values.filter((v): v is number => v !== null)
  const { ticks, lo, hi } = niceTicks(Math.min(0, ...known), Math.max(0, ...known), 4)
  const y = (v: number) => m.t + ((hi - v) / (hi - lo || 1)) * (h - m.t - m.b)
  const slot = plotW / Math.max(games.length, 1)
  const bar = Math.min(24, Math.max(4, slot - 6))
  const digits = metric === 'cs' ? 1 : 0
  const zero = y(0)
  const shape = (cx: number, v: number) => {
    const x0 = cx - bar / 2,
      x1 = cx + bar / 2,
      end = y(v)
    const r = Math.min(4, bar / 2, Math.abs(end - zero))
    const d = v >= 0 ? 1 : -1
    // Rounded at the data end, square on the baseline.
    return `M${x0},${zero}L${x0},${end + d * r}Q${x0},${end} ${x0 + r},${end}L${x1 - r},${end}Q${x1},${end} ${x1},${end + d * r}L${x1},${zero}Z`
  }
  const active = hover === null ? null : games[hover]
  return (
    <div className="chart" ref={ref}>
      <div className="chart-legend" aria-hidden>
        <span>
          <i className="swatch win" />
          Win
        </span>
        <span>
          <i className="swatch loss" />
          Loss
        </span>
      </div>
      <svg
        width={width}
        height={h}
        role="img"
        aria-label={`${metricNames[metric]} difference at 15 minutes for each game, oldest to newest`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              className={t === 0 ? 'chart-zero' : 'chart-grid'}
              x1={m.l}
              x2={width - m.r}
              y1={y(t)}
              y2={y(t)}
            />
            <text className="chart-tick" x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {games.map((g, i) => {
          const cx = m.l + slot * (i + 0.5)
          const v = values[i]
          const result = g.player.win ? 'win' : 'loss'
          return (
            <g
              key={g.id}
              className={`chart-bar-group ${hover === i ? 'hovered' : ''}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${dateLabel(g.gameCreation)}, ${g.player.win ? 'win' : 'loss'}, ${v === null ? 'no timeline' : signed(v, digits)}`}
            >
              <rect
                className="chart-hit"
                x={cx - slot / 2}
                y={m.t}
                width={slot}
                height={h - m.t - m.b}
              />
              {v === null ? (
                <circle className="chart-missing" cx={cx} cy={zero} r={3} />
              ) : (
                <path className={`chart-bar ${result}`} d={shape(cx, v)} />
              )}
              {slot >= 14 && (
                <text className="chart-tick" x={cx} y={h - 8} textAnchor="middle">
                  {g.player.win ? 'W' : 'L'}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <Tooltip
        tip={
          active && {
            x: Math.min(m.l + slot * (hover! + 0.5) + 12, width - 170),
            y: m.t,
            content: (
              <>
                <small>
                  {dateLabel(active.gameCreation)} · {active.player.win ? 'Win' : 'Loss'}
                  {anyChampion ? ` · ${championLabel(active.player.championName)}` : ''}
                </small>
                <span>
                  <strong>
                    {values[hover!] === null ? 'No timeline' : signed(values[hover!], digits)}
                  </strong>
                  {metricNames[metric]} at 15
                </span>
                <span>
                  <strong>
                    {active.player.kills}/{active.player.deaths}/{active.player.assists}
                  </strong>
                  {kda(active.player)} KDA
                </span>
              </>
            ),
          }
        }
      />
    </div>
  )
}
