import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ItemBuild, Loadout } from './Loadout'
import {
  championGroups,
  championIcon,
  cs,
  duration,
  kda,
  number,
  percent,
  queues,
  remake,
  roleNames,
  seasonOf,
  splitOf,
  summary,
  timeAgo,
  type Game,
  type Participant,
  type Rank,
} from '../lib/league'

// Presentational League pieces shared by Home (your accounts) and Summoners (anyone).

export function Champion({ id, name, size = 36 }: { id: number; name: string; size?: number }) {
  return (
    <img
      className="champion-icon"
      src={championIcon(id)}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}
export function Select({
  label,
  value,
  onChange,
  children,
  compact = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <label className={compact ? 'league-select compact' : 'league-select'}>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  )
}
export function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="league-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export function SeasonChampions({
  games,
  choose,
}: {
  games: Game[]
  choose: (id: number) => void
}) {
  const seasons = [...new Set(games.map((g) => seasonOf(g)))].sort((a, b) => b - a)
  const [year, setYear] = useState(''),
    [split, setSplit] = useState('')
  const selectedYear = seasons.includes(Number(year)) ? Number(year) : seasons[0]
  // Use the native patch boundaries, including games with no known split.
  const splits = [
    ...new Set(
      games
        .filter((g) => seasonOf(g) === selectedYear)
        .flatMap((g) => (splitOf(g) === null ? [] : [splitOf(g)!])),
    ),
  ].sort()
  const selectedSplit =
    split === 'all'
      ? null
      : splits.includes(Number(split))
        ? Number(split)
        : (splits.at(-1) ?? null)
  const list = championGroups(
    games.filter(
      (g) =>
        seasonOf(g) === selectedYear && (selectedSplit === null || splitOf(g) === selectedSplit),
    ),
  )
  return (
    <section className="league-card league-rail-champions">
      <div className="league-rail-heading">
        <h2>Champions</h2>
        <div className="league-controls">
          <Select
            label="Season"
            value={String(selectedYear)}
            onChange={(v) => {
              setYear(v)
              setSplit('')
            }}
          >
            {seasons.map((y) => (
              <option key={y} value={y}>
                Season {y}
              </option>
            ))}
          </Select>
          <Select
            label="Split"
            value={selectedSplit === null ? 'all' : String(selectedSplit)}
            onChange={setSplit}
          >
            <option value="all">Whole season</option>
            {splits.map((s) => (
              <option key={s} value={s}>
                Split {s}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <ul className="league-champion-list">
        {list.map((c) => (
          <li key={c.id}>
            <button className="league-champion-row" onClick={() => choose(c.id)}>
              <Champion id={c.id} name={c.name} size={36} />
              <span className="league-champion-name">
                <strong>{c.name}</strong>
                <small>
                  {number(c.summary.csPerMinute)} CS/min · {c.summary.games}{' '}
                  {c.summary.games === 1 ? 'game' : 'games'}
                </small>
              </span>
              <span className="league-champion-kda">
                <strong>{kda(c.summary)}</strong>
                <small>KDA</small>
              </span>
              <span
                className={`league-champion-wr ${(c.summary.winRate ?? 0) >= 0.5 ? 'good' : 'bad'}`}
              >
                <strong>{percent(c.summary.winRate)}</strong>
                <small>
                  {c.summary.wins}W {c.summary.losses}L
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <small className="muted">Synced games · remakes excluded</small>
    </section>
  )
}

export function RankCard({ rank, embedded = false }: { rank: Rank; embedded?: boolean }) {
  const solo = rank.queueType === 'RANKED_SOLO_5x5'
  const games = rank.wins + rank.losses
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rank.tier)
  const tier = rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase()
  return (
    <section
      className={embedded ? 'league-rank-card embedded' : 'league-card league-rank-card'}
      aria-label={solo ? 'Solo/Duo rank' : 'Flex rank'}
    >
      {!embedded && <span className="eyebrow">{solo ? 'RANKED SOLO/DUO' : 'RANKED FLEX'}</span>}
      <div className="league-rank-body">
        <img
          src={`https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${rank.tier.toLowerCase()}.svg`}
          alt=""
          width={64}
          height={64}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
        <div>
          <strong>
            {tier}
            {apex ? '' : ` ${rank.rank}`}
          </strong>
          <span className="league-rank-lp">{rank.leaguePoints} LP</span>
        </div>
        <div className="league-rank-record">
          <span>
            {rank.wins}W {rank.losses}L
          </span>
          <b>{percent(games ? rank.wins / games : null)} win rate</b>
        </div>
      </div>
    </section>
  )
}

export function WinDonut({ rate }: { rate: number | null }) {
  const radius = 30
  const length = 2 * Math.PI * radius
  return (
    <svg
      className="league-donut"
      viewBox="0 0 80 80"
      role="img"
      aria-label={`Win rate ${percent(rate)}`}
    >
      <circle cx="40" cy="40" r={radius} className="loss" />
      <circle
        cx="40"
        cy="40"
        r={radius}
        className="win"
        strokeDasharray={`${(rate ?? 0) * length} ${length}`}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="45" textAnchor="middle">
        {percent(rate)}
      </text>
    </svg>
  )
}

export function MatchRow({
  game: g,
  onOpenPlayer,
  busy,
}: {
  game: Game
  onOpenPlayer: (player: Participant) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const p = g.player,
    teamKills = g.allies.reduce((n, p) => n + p.kills, 0)
  const outcome = remake(g) ? 'Remake' : p.win ? 'Victory' : 'Defeat'
  return (
    <article className={`league-match ${remake(g) ? 'remake' : p.win ? 'win' : 'loss'}`}>
      <button
        className="league-match-toggle"
        aria-expanded={open}
        aria-controls={`score-${g.id}`}
        onClick={() => setOpen(!open)}
      >
        <div className="league-match-result">
          <strong>{outcome}</strong>
          <span>{queues[g.queueId] || `Queue ${g.queueId}`}</span>
          <small>
            <time dateTime={new Date(g.gameCreation).toISOString()}>{timeAgo(g.gameCreation)}</time>{' '}
            · {duration(g.gameDuration)}
          </small>
        </div>
        <div className="league-match-champion">
          <span className="league-portrait">
            <Champion id={p.championId} name={p.championName} size={52} />
            <b>{p.champLevel}</b>
          </span>
          <Loadout player={p} />
          <span className="league-match-name">
            <strong>{p.championName}</strong>
            <small>{roleNames[p.teamPosition] || 'No lane'}</small>
          </span>
        </div>
        <div className="league-match-kda">
          <strong>
            {p.kills} / <b>{p.deaths}</b> / {p.assists}
          </strong>
          <small>{kda(p)} KDA</small>
          <small>
            {percent(teamKills ? (p.kills + p.assists) / teamKills : null)} KP ·{' '}
            {number(cs(p) / Math.max(g.gameDuration / 60, 1))} CS/m
          </small>
        </div>
        <ItemBuild player={p} version={g.gameVersion} size={26} />
        {g.opponent ? (
          <div className="league-opponent">
            <span className="muted">vs</span>
            <Champion id={g.opponent.championId} name={g.opponent.championName} size={32} />
            <small>{g.opponent.championName}</small>
          </div>
        ) : (
          <span />
        )}
        <span className="league-score-toggle">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span className="sr-only">Scoreboard for {g.id}</span>
        </span>
      </button>
      {open && (
        <div className="league-scoreboard" id={`score-${g.id}`}>
          <div className="league-game-meta">
            {g.id} · Patch {g.gameVersion.split('.').slice(0, 2).join('.')} ·{' '}
            {new Date(g.gameCreation).toLocaleString('en-GB')}
          </div>
          {[...new Set([p.teamId, ...g.participants.map((p) => p.teamId)])].map((team) => (
            <Scoreboard
              key={team}
              players={g.participants.filter((p) => p.teamId === team)}
              game={g}
              onOpenPlayer={onOpenPlayer}
              busy={busy}
            />
          ))}
        </div>
      )}
    </article>
  )
}

export function Scoreboard({
  players,
  game,
  onOpenPlayer,
  busy,
}: {
  players: Participant[]
  game: Game
  onOpenPlayer: (player: Participant) => void
  busy: boolean
}) {
  const team = players[0].teamId
  const teamKills = players.reduce((n, p) => n + p.kills, 0)
  const maxDamage = Math.max(1, ...game.participants.map((p) => p.totalDamageDealtToChampions))
  return (
    <div className={`league-team ${players[0].win ? 'win' : 'loss'}`}>
      <div className="league-team-heading">
        <strong>
          {players[0].win ? 'Victory' : 'Defeat'} ·{' '}
          {team === 100 ? 'Blue team' : team === 200 ? 'Red team' : `Team ${team}`}
        </strong>
        <span>
          {teamKills} kills · {number(players.reduce((n, p) => n + p.goldEarned, 0) / 1000)}k gold
        </span>
      </div>
      <div className="league-table-wrap">
        <table className="league-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>KDA</th>
              <th>Damage</th>
              <th>Wards</th>
              <th>CS</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.puuid}
                className={p.puuid === game.player.puuid ? 'league-focused-player' : ''}
              >
                <td>
                  <div className="league-player">
                    <span className="league-portrait">
                      <Champion id={p.championId} name={p.championName} size={36} />
                      <b>{p.champLevel}</b>
                    </span>
                    <Loadout player={p} />
                    <span className="league-player-name">
                      <button
                        className="league-player-link"
                        disabled={busy}
                        title={`Open ${p.riotIdGameName || p.championName}'s profile`}
                        onClick={() => onOpenPlayer(p)}
                      >
                        {p.riotIdGameName || p.summonerName || p.championName}
                        {p.riotIdTagline ? `#${p.riotIdTagline}` : ''}
                      </button>
                      <small>
                        {typeof p.summonerLevel === 'number' && (
                          <>
                            <span className="league-account-level">Lv. {p.summonerLevel}</span>{' '}
                            ·{' '}
                          </>
                        )}
                        {p.championName} · {roleNames[p.teamPosition] || '—'}
                      </small>
                    </span>
                  </div>
                </td>
                <td>
                  <strong>
                    {p.kills} / <b>{p.deaths}</b> / {p.assists}
                  </strong>
                  <small>
                    {kda(p)} · {percent(teamKills ? (p.kills + p.assists) / teamKills : null)} KP
                  </small>
                </td>
                <td>
                  <div className="league-damage">
                    <span title={`${number(p.totalDamageTaken, 0)} damage taken`}>
                      {number(p.totalDamageDealtToChampions, 0)}
                    </span>
                    <i>
                      <b
                        style={{ width: `${(p.totalDamageDealtToChampions / maxDamage) * 100}%` }}
                      />
                    </i>
                  </div>
                </td>
                <td>
                  {p.wardsPlaced} / {p.wardsKilled}
                  <small>
                    {p.visionWardsBoughtInGame} control · {p.visionScore} vision
                  </small>
                </td>
                <td>
                  {cs(p)}
                  <small>{number(cs(p) / Math.max(game.gameDuration / 60, 1))}/m</small>
                </td>
                <td>
                  <ItemBuild player={p} version={game.gameVersion} size={22} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function RecentSummary({
  recent,
  footer,
  controls,
}: {
  recent: Game[]
  footer?: React.ReactNode
  controls?: React.ReactNode
}) {
  const stats = summary(recent)
  return (
    <section className="league-card league-summary" aria-label="Recent game statistics">
      <div className="league-summary-grid">
        <div className="league-summary-record">
          <WinDonut rate={stats.winRate} />
          <div>
            <strong>
              {stats.wins}W {stats.losses}L
            </strong>
            <span className="muted">
              {stats.games} games
              {stats.remakes ? ` · ${stats.remakes} remake${stats.remakes > 1 ? 's' : ''}` : ''}
            </span>
          </div>
        </div>
        <div className="league-summary-kda">
          <strong>{stats.games ? kda(stats) : '—'}</strong>
          <span>
            {number(stats.averageKills)} / <b>{number(stats.averageDeaths)}</b> /{' '}
            {number(stats.averageAssists)}
          </span>
          <small className="muted">KDA</small>
        </div>
        <div className="league-metrics">
          <Metric label="Kill participation" value={percent(stats.killParticipation)} />
          <Metric label="CS / min" value={number(stats.csPerMinute)} />
          <Metric label="Damage share" value={percent(stats.damageShare)} />
          <small className="muted">
            {stats.primaryRole ? `${roleNames[stats.primaryRole]} games only` : 'All roles'}
          </small>
        </div>
        <div className="league-summary-roles">
          <span className="eyebrow">ROLES</span>
          {stats.roles.map(({ role, games }) => {
            const s = summary(games)
            return (
              <div className="league-role-row" key={role}>
                <strong>{roleNames[role]}</strong>
                <span className="league-role-bar">
                  <i style={{ width: `${(games.length / (stats.games || 1)) * 100}%` }} />
                </span>
                <span>
                  {games.length}G · {percent(s.winRate)}
                </span>
              </div>
            )
          })}
          {!stats.roles.length && <span className="muted">No assigned roles</span>}
        </div>
      </div>
      <div className="league-form" aria-label="Recent results, newest first">
        {recent.map((g) => (
          <span
            key={g.id}
            className={`league-result ${remake(g) ? 'remake' : g.player.win ? 'win' : 'loss'}`}
            title={`${g.player.championName}: ${remake(g) ? 'Remake' : g.player.win ? 'Victory' : 'Defeat'}`}
          >
            {remake(g) ? 'R' : g.player.win ? 'W' : 'L'}
          </span>
        ))}
        {stats.streak && (
          <small>
            {stats.streak.count} {stats.streak.win ? 'win' : 'loss'} streak
          </small>
        )}
        {controls}
      </div>
      {footer}
    </section>
  )
}
