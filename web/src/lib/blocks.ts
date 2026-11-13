import { rpc } from './supabase'

export interface BlockGame {
  id: string
  title: string
  notes: string
}

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
