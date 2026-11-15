import { useMemo, type ReactNode } from 'react'
import { Bug, Castle, Eye, Skull, Swords, X } from 'lucide-react'
import { championIcon } from '../lib/league'
import { boardAt, replayAll, trinkets, type BoardPlayer, type BoardTeam } from '../lib/board'
import { clock, stacks, type ReviewPayload } from '../lib/review-timeline'
import { Items, patchOf } from './TimelineRows'
import { LoadoutIcons } from './Loadout'

const k = (gold: number) => `${(gold / 1000).toFixed(1)}k`
const side = (teamId: number) => (teamId === 100 ? 'Blue' : 'Red')
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
/** Item slots in an inventory, not counting the trinket. */
const slots = 6

/** The in-game Tab scoreboard as it stood at `gameMs`, over the video: blue left, red right. */
export function ReviewBoard({
  review,
  gameMs,
  onClose,
}: {
  review: ReviewPayload
  gameMs: number
  onClose(): void
}) {
  const replays = useMemo(() => replayAll(review), [review])
  const at = Math.max(0, Math.min(gameMs, review.gameDuration * 1000))
  const board = boardAt(review, replays, at)
  const patch = patchOf(review.gameVersion)
  const unchecked = review.participants.every((p) => !p.finalItems)
  const noLoadout = review.participants.every((p) => !p.runes)
  const [blue, red] = board.teams
  return (
    <div className="review-board-layer">
      <section className="review-board" aria-label={`Scoreboard at ${clock(at)}`}>
        <header>
          <strong>Board · {clock(at)}</strong>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close board"
            title="Close (B)"
          >
            <X size={15} />
          </button>
        </header>
        <div className="board-score">
          <Objectives team={blue} />
          <div className="board-centre">
            <Dragons blue={blue.dragons} red={red.dragons} />
            <div className="board-kills" aria-label={`Kills: Blue ${blue.kills}, Red ${red.kills}`}>
              <span className="blue">{blue.kills}</span>
              <Swords size={13} aria-hidden />
              <span className="red">{red.kills}</span>
            </div>
            <GoldLead blue={blue.gold} red={red.gold} />
          </div>
          <Objectives team={red} />
        </div>
        <div className="board-sides">
          {board.teams.map((team) => (
            <TeamBoard key={team.teamId} team={team} playerId={review.playerId} patch={patch} />
          ))}
        </div>
        <footer>
          Items to the second from Riot’s item log.{' '}
          {board.snapshotAt !== null
            ? `Level, CS and gold as of ${clock(board.snapshotAt)} (Riot records them once a minute).`
            : 'Level, CS and gold arrive with the first minute.'}
          {unchecked &&
            ' This review has no final items, so a support’s quest upgrade can’t be named.'}
          {noLoadout &&
            ' This review has no runes or summoner spells yet; Refresh timeline (cog → Change game) adds them.'}
        </footer>
      </section>
    </div>
  )
}

/** One side's taken objectives, mirrored on red so both read outward from the kill score. */
function Objectives({ team }: { team: BoardTeam }) {
  const stats: [number, string, ReactNode][] = [
    [team.barons, 'baron', <Skull key="b" size={13} aria-hidden />],
    [team.heralds, 'herald', <Eye key="h" size={13} aria-hidden />],
    [team.grubs, 'grub', <Bug key="g" size={13} aria-hidden />],
    [team.towers, 'tower', <Castle key="t" size={13} aria-hidden />],
  ]
  const label = `${side(team.teamId)} objectives`
  return (
    <ul className={`board-objectives ${side(team.teamId).toLowerCase()}`} aria-label={label}>
      {(team.teamId === 100 ? stats : [...stats].reverse()).map(([n, name, icon]) => (
        <li key={name} title={plural(n, name)} aria-label={plural(n, name)}>
          {icon}
          <span>{n}</span>
        </li>
      ))}
    </ul>
  )
}

/** Four pips a side, like the dragon soul tracker; elder and later dragons show as a count. */
function Dragons({ blue, red }: { blue: number; red: number }) {
  const pips = (n: number) =>
    Array.from({ length: 4 }, (_, i) => <i key={i} className={i < n ? 'taken' : ''} />)
  return (
    <div
      className="board-dragons"
      title={`Dragons: Blue ${blue}, Red ${red}`}
      aria-label={`Dragons: Blue ${blue}, Red ${red}`}
    >
      <span className="blue">
        {blue > 4 && <small>+{blue - 4}</small>}
        {pips(blue).reverse()}
      </span>
      <span className="red">
        {pips(red)}
        {red > 4 && <small>+{red - 4}</small>}
      </span>
    </div>
  )
}

function GoldLead({ blue, red }: { blue: number | null; red: number | null }) {
  if (blue === null || red === null) return null
  const lead = blue - red
  const leader = lead > 0 ? 'blue' : lead < 0 ? 'red' : ''
  return (
    <div className={`board-gold ${leader}`} title={`Blue ${k(blue)} gold · Red ${k(red)} gold`}>
      {lead === 0
        ? 'Gold even'
        : `${lead > 0 ? '◀ ' : ''}+${k(Math.abs(lead))} gold${lead < 0 ? ' ▶' : ''}`}
    </div>
  )
}

function TeamBoard({
  team,
  playerId,
  patch,
}: {
  team: BoardTeam
  playerId: number
  patch: string
}) {
  return (
    <ul
      className={`board-team ${side(team.teamId).toLowerCase()}`}
      aria-label={`${side(team.teamId)} team`}
    >
      {team.players.map((p) => (
        <PlayerRow key={p.id} player={p} focused={p.id === playerId} patch={patch} />
      ))}
    </ul>
  )
}

function PlayerRow({
  player: p,
  focused,
  patch,
}: {
  player: BoardPlayer
  focused: boolean
  patch: string
}) {
  const held = stacks(p.items.filter((i) => !trinkets.has(i)))
  const trinket = stacks(p.items.filter((i) => trinkets.has(i))).slice(0, 1)
  return (
    <li className={focused ? 'focused' : ''}>
      <LoadoutIcons spells={p.spells ?? []} runes={p.runes ?? []} className="board-loadout" />
      <span className="board-champion" title={p.championName}>
        <img src={championIcon(p.championId)} alt="" width={28} height={28} loading="lazy" />
        {p.level !== null && <small aria-label={`level ${p.level}`}>{p.level}</small>}
        {p.verified === false && (
          <abbr title="Riot’s item log doesn’t fully explain this player’s final items, so some items here may be missing or late.">
            ≈
          </abbr>
        )}
      </span>
      <span className="sr-only">{p.championName}</span>
      <span className="board-cs" title="Creep score">
        {p.cs ?? '—'}
      </span>
      <span className="board-kda" title="Kills / deaths / assists">
        {p.kills}/{p.deaths}/{p.assists}
      </span>
      <Items stacks={held} patch={patch} empty={Math.max(0, slots - held.length)} />
      <Items stacks={trinket} patch={patch} empty={1 - trinket.length} />
    </li>
  )
}
