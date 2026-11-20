import { rpc } from './supabase'
import { cs, remake, type Game, type Participant } from './league'

// A compact copy of the game as played, so the block still reads right if the match cache changes.
export interface BlockMatch {
  matchId: string
  profileId: string
  championId: number
  championName: string
  opponentName?: string
  kills: number
  deaths: number
  assists: number
  win: boolean
  remake: boolean
  queueId: number
  gameCreation: number
  gameDuration: number
  // Richer detail, added for the game cards. Older snapshots lack it and are filled in live.
  gameVersion?: string
  role?: string
  champLevel?: number
  cs?: number
  gold?: number
  damage?: number
  vision?: number
  teamKills?: number
  items?: number[]
  allies?: BlockPlayer[]
  enemies?: BlockPlayer[]
}

export interface BlockPlayer {
  championId: number
  championName: string
  role: string
  you?: boolean
  lane?: boolean
}

export interface BlockGame {
  id: string
  title: string
  notes: string
  match?: BlockMatch
}

const teamPlayer = (p: Participant, extra: Partial<BlockPlayer> = {}): BlockPlayer => ({
  championId: p.championId,
  championName: p.championName,
  role: p.teamPosition,
  ...extra,
})

export const matchSnapshot = (game: Game, profileId: string): BlockMatch => ({
  matchId: game.id,
  profileId,
  championId: game.player.championId,
  championName: game.player.championName,
  ...(game.opponent ? { opponentName: game.opponent.championName } : {}),
  kills: game.player.kills,
  deaths: game.player.deaths,
  assists: game.player.assists,
  win: game.player.win,
  remake: remake(game),
  queueId: game.queueId,
  gameCreation: game.gameCreation,
  gameDuration: game.gameDuration,
  gameVersion: game.gameVersion,
  role: game.player.teamPosition,
  champLevel: game.player.champLevel,
  cs: cs(game.player),
  gold: game.player.goldEarned,
  damage: game.player.totalDamageDealtToChampions,
  vision: game.player.visionScore,
  teamKills: game.allies.reduce((n, p) => n + p.kills, 0),
  items: [
    game.player.item0,
    game.player.item1,
    game.player.item2,
    game.player.item3,
    game.player.item4,
    game.player.item5,
    game.player.item6,
  ],
  allies: game.allies.map((p) => teamPlayer(p, p === game.player ? { you: true } : {})),
  enemies: game.participants
    .filter((p) => p.teamId !== game.player.teamId)
    .map((p) => teamPlayer(p, p === game.opponent ? { lane: true } : {})),
})

export interface Block {
  id: string
  title: string
  carryIn: string[]
  games: BlockGame[]
  carryForward: string[]
  revision: number
  createdAt: string
  updatedAt: string
}

export interface BlockDraft {
  title: string
  games: BlockGame[]
  carryForward: string[]
}

export interface BlockRepository {
  list(): Promise<Block[]>
  create(title: string): Promise<Block>
  save(id: string, revision: number, draft: BlockDraft): Promise<Block>
  remove(id: string): Promise<void>
}

// Blank carry-forward points are an editing convenience, never stored.
export const cleanDraft = (draft: BlockDraft): BlockDraft => ({
  title: draft.title.trim(),
  games: draft.games,
  carryForward: draft.carryForward.map((point) => point.trim()).filter(Boolean),
})

export const blockRepository: BlockRepository = {
  list: () => rpc('list_blocks'),
  create: (title) => rpc('create_block', { p_title: title }),
  save: (id, revision, draft) => {
    const clean = cleanDraft(draft)
    return rpc('save_block', {
      p_id: id,
      p_revision: revision,
      p_title: clean.title,
      p_games: clean.games,
      p_carry_forward: clean.carryForward,
    })
  },
  remove: (id) => rpc('delete_block', { p_id: id }),
}
