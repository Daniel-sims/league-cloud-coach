import { rpc } from './supabase'

export type ObjectivePhase = 'in_game' | 'post_game'
export const objectivePhases: { phase: ObjectivePhase; name: string; hint: string }[] = [
  { phase: 'in_game', name: 'In-game', hint: 'Focus on these while playing.' },
  { phase: 'post_game', name: 'Post-game', hint: 'Work through these when reviewing the game.' },
]
export const objectiveTitleMax = 200
export const objectiveDetailsMax = 4000

export interface Objective {
  id: string
  phase: ObjectivePhase
  title: string
  details: string
  revision: number
  archivedAt: string | null
  editedRole: 'owner' | 'coach'
  editedBy: string | null
  createdAt: string
  updatedAt: string
}
export interface ObjectiveList {
  /** The name coaches see, chosen by the owner. */
  playerName: string | null
  /** Current objectives first, each phase in order, then past (archived) ones. */
  objectives: Objective[]
}
export type ObjectiveDraft = { phase: ObjectivePhase; title: string; details: string }
export type ObjectiveChange =
  | ({ action: 'create' } & ObjectiveDraft)
  | ({ action: 'update'; id: string; revision: number } & ObjectiveDraft)
  | { action: 'archive' | 'restore' | 'delete' | 'up' | 'down'; id: string }

/// The owner and watch-link holders change the same list; every change
/// returns the whole list so the view never drifts from the server.
export interface ObjectivesRepository {
  role: 'owner' | 'coach'
  load(): Promise<ObjectiveList | null>
  change(change: ObjectiveChange): Promise<ObjectiveList>
  setPlayerName?(name: string): Promise<ObjectiveList>
}

const changeArgs = (change: ObjectiveChange) => ({
  p_action: change.action,
  p_id: 'id' in change ? change.id : null,
  p_phase: 'phase' in change ? change.phase : null,
  p_title: 'title' in change ? change.title : null,
  p_details: 'details' in change ? change.details : null,
  p_revision: 'revision' in change ? change.revision : null,
})

export const ownerObjectives: ObjectivesRepository = {
  role: 'owner',
  load: () => rpc<ObjectiveList>('get_learning_objectives'),
  change: (change) => rpc<ObjectiveList>('change_learning_objective', changeArgs(change)),
  setPlayerName: (name) => rpc<ObjectiveList>('set_objectives_player_name', { p_name: name }),
}

export function sharedObjectives(
  token: string,
  authorKey: string,
  authorName: () => string,
): ObjectivesRepository {
  return {
    role: 'coach',
    load: () => rpc<ObjectiveList | null>('get_shared_objectives', { p_token: token }),
    change: (change) =>
      rpc<ObjectiveList>('change_shared_objective', {
        p_token: token,
        p_author_key: authorKey,
        p_author_name: authorName().trim() || null,
        ...changeArgs(change),
      }),
  }
}

export const currentObjectives = (list: ObjectiveList | null) =>
  list?.objectives.filter((o) => !o.archivedAt) ?? []

/** "Daniel’s learning objectives"; without a name, plain "Learning objectives". */
export function objectivesTitle(role: 'owner' | 'coach', playerName: string | null | undefined) {
  if (role === 'owner') return 'Your learning objectives'
  const name = playerName?.trim()
  if (!name) return 'Learning objectives'
  return `${name}${/s$/i.test(name) ? '’' : '’s'} learning objectives`
}
