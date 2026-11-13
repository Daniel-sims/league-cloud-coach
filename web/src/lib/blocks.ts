import { rpc } from './supabase'
import { remake, type Game } from './league'

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
}

export interface BlockGame {
  id: string
  title: string
  notes: string
  match?: BlockMatch
}

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
