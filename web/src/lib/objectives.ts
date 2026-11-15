import { rpc } from './supabase'

export const objectivesMaxLength = 50000

// Revision 0 means nothing has been saved yet.
export interface LearningObjectives {
  body: string
  revision: number
  updatedAt: string | null
}

export interface ObjectivesRepository {
  get(): Promise<LearningObjectives>
  save(revision: number, body: string): Promise<LearningObjectives>
}

export const objectivesRepository: ObjectivesRepository = {
  get: () => rpc('get_learning_objectives'),
  save: (revision, body) => rpc('save_learning_objectives', { p_revision: revision, p_body: body }),
}
