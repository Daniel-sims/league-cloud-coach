import { useMemo } from 'react'
import { X } from 'lucide-react'
import { championIcon } from '../lib/league'
import { boardAt, replayAll, type BoardPlayer, type BoardTeam } from '../lib/board'
import { clock, stacks, type ReviewPayload } from '../lib/review-timeline'
import { Items, patchOf } from './TimelineRows'

const k = (gold: number) => `${(gold / 1000).toFixed(1)}k`

/** The in-game scoreboard as it stood at `gameMs`, over the video. */
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
        {board.teams.map((team) => (
          <TeamBoard key={team.teamId} team={team} playerId={review.playerId} patch={patch} />
        ))}
        <footer>
          Items to the second from Riot’s item log.{' '}
          {board.snapshotAt !== null
            ? `Level, CS and gold as of ${clock(board.snapshotAt)} (Riot records them once a minute).`
            : 'Level, CS and gold arrive with the first minute.'}
          {unchecked &&
            ' This review has no final items, so a support’s quest upgrade can’t be named.'}
        </footer>
      </section>
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
  const objectives = [
    [team.towers, 'tower'],
    [team.dragons, 'dragon'],
    [team.grubs, 'grub'],
    [team.heralds, 'herald'],
    [team.barons, 'baron'],
  ] as const
  return (
    <div className={`board-team ${team.teamId === 100 ? 'blue' : 'red'}`}>
      <div className="board-team-head">
        <strong>{team.teamId === 100 ? 'Blue' : 'Red'}</strong>
        <span>{team.kills === 1 ? '1 kill' : `${team.kills} kills`}</span>
        {team.gold !== null && <span>{k(team.gold)} gold</span>}
        {objectives
          .filter(([n]) => n > 0)
          .map(([n, name]) => (
            <span key={name}>
              {n} {n === 1 ? name : `${name}s`}
            </span>
          ))}
      </div>
      <ul>
        {team.players.map((p) => (
          <PlayerRow key={p.id} player={p} focused={p.id === playerId} patch={patch} />
        ))}
      </ul>
    </div>
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
  return (
    <li className={focused ? 'focused' : ''}>
      <span className="board-champion">
        <img src={championIcon(p.championId)} alt="" width={24} height={24} loading="lazy" />
        {p.level !== null && <small>{p.level}</small>}
      </span>
      <span className="board-name" title={p.championName}>
        {p.championName}
        {p.verified === false && (
          <abbr title="Riot’s item log doesn’t fully explain this player’s final items, so some items here may be missing or late.">
            ≈
          </abbr>
        )}
      </span>
      <span className="board-kda">
        {p.kills}/{p.deaths}/{p.assists}
      </span>
      <span className="board-cs" title="Creep score">
        {p.cs ?? '—'}
      </span>
      <Items stacks={stacks(p.items)} patch={patch} />
    </li>
  )
}
