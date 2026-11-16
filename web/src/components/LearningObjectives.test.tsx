import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LearningObjectives, ObjectivesBriefing, ObjectivesDialog } from './LearningObjectives'
import type {
  Objective,
  ObjectiveChange,
  ObjectiveList,
  ObjectivesRepository,
} from '../lib/objectives'

const at = '2026-11-15T10:00:00Z'
const objective = (patch: Partial<Objective>): Objective => ({
  id: 'o1',
  phase: 'post_game',
  title: 'R usage',
  details: '',
  revision: 1,
  archivedAt: null,
  editedRole: 'owner',
  editedBy: null,
  createdAt: at,
  updatedAt: at,
  ...patch,
})

/** An in-memory server: applies changes the way the RPC does. */
function repo(initial: ObjectiveList, role: 'owner' | 'coach' = 'owner') {
  let list = structuredClone(initial)
  let next = 100
  const change = vi.fn(async (c: ObjectiveChange) => {
    const items = list.objectives
    if (c.action === 'create')
      items.push(
        objective({ id: `n${next++}`, phase: c.phase, title: c.title, details: c.details }),
      )
    else {
      const i = items.findIndex((o) => o.id === c.id)
      if (c.action === 'update') {
        if (items[i].revision !== c.revision)
          throw new Error(
            'This objective changed or was removed. Reload the objectives to see the latest.',
          )
        Object.assign(items[i], {
          phase: c.phase,
          title: c.title,
          details: c.details,
          revision: c.revision + 1,
          updatedAt: '2026-11-16T10:00:00Z',
        })
      } else if (c.action === 'archive') items[i].archivedAt = at
      else if (c.action === 'restore') items[i].archivedAt = null
      else if (c.action === 'delete') items.splice(i, 1)
      else {
        const j = c.action === 'up' ? i - 1 : i + 1
        ;[items[i], items[j]] = [items[j], items[i]]
      }
    }
    list.objectives = [...items.filter((o) => !o.archivedAt), ...items.filter((o) => o.archivedAt)]
    return structuredClone(list)
  })
  const repository: ObjectivesRepository & { change: typeof change } = {
    role,
    load: vi.fn(async () => structuredClone(list)),
    change,
    ...(role === 'owner'
      ? {
          setPlayerName: vi.fn(async (name: string) => {
            list = { ...list, playerName: name.trim() || null }
            return structuredClone(list)
          }),
        }
      : {}),
  }
  return repository
}
afterEach(cleanup)

const sample = (): ObjectiveList => ({
  playerName: 'Daniel',
  objectives: [
    objective({ id: 'a', phase: 'in_game', title: 'Track the jungler' }),
    objective({
      id: 'b',
      title: 'R usage (building patience)',
      details: 'In hindsight, was the R necessary?\nCAVEAT: windows WILL present themselves',
      editedRole: 'coach',
      editedBy: 'Coach Sam',
    }),
    objective({ id: 'c', title: 'Review transitions' }),
    objective({ id: 'd', title: 'Old focus', archivedAt: at }),
  ],
})

it('groups current objectives into in game and post game, with past ones apart', async () => {
  render(<LearningObjectives repository={repo(sample())} />)
  const inGame = await screen.findByRole('region', { name: 'In-game objectives' })
  expect(within(inGame).getByText('Track the jungler')).toBeInTheDocument()
  const postGame = screen.getByRole('region', { name: 'Post-game objectives' })
  expect(
    within(postGame)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual([expect.stringContaining('R usage'), expect.stringContaining('Review transitions')])
  expect(within(postGame).getByText(/CAVEAT: windows/)).toBeInTheDocument()
  expect(within(postGame).getByText(/Added by Coach Sam/)).toBeInTheDocument()
  expect(screen.getByText('Past objectives (1)')).toBeInTheDocument()
  expect(screen.getByText(/as “Daniel’s learning objectives”/)).toBeInTheDocument()
})

it('adds, edits, reorders, archives and deletes objectives', async () => {
  const repository = repo(sample())
  render(<LearningObjectives repository={repository} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Add in-game objective' }))
  await userEvent.type(screen.getByLabelText('Objective'), 'Ward river at 3:00')
  await userEvent.type(screen.getByLabelText('Details'), 'Before first scuttle')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(repository.change).toHaveBeenLastCalledWith({
    action: 'create',
    phase: 'in_game',
    title: 'Ward river at 3:00',
    details: 'Before first scuttle',
  })
  expect(await screen.findByText('Ward river at 3:00')).toBeInTheDocument()

  // Moving an objective to the other phase.
  await userEvent.click(screen.getByRole('button', { name: 'Edit “Review transitions”' }))
  await userEvent.click(screen.getByRole('radio', { name: 'In-game' }))
  await userEvent.clear(screen.getByLabelText('Objective'))
  await userEvent.type(screen.getByLabelText('Objective'), 'Play transitions')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(repository.change).toHaveBeenLastCalledWith({
    action: 'update',
    id: 'c',
    revision: 1,
    phase: 'in_game',
    title: 'Play transitions',
    details: '',
  })
  await userEvent.click(
    await screen.findByRole('button', { name: 'Move “Track the jungler” down' }),
  )
  expect(repository.change).toHaveBeenLastCalledWith({ action: 'down', id: 'a' })
  await userEvent.click(
    screen.getByRole('button', { name: 'Archive “R usage (building patience)”' }),
  )
  expect(await screen.findByText('Past objectives (2)')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Edit “Play transitions”' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(repository.change).toHaveBeenLastCalledWith({ action: 'delete', id: 'c' })
  await waitFor(() => expect(screen.queryByText('Play transitions')).toBeNull())
})

it('reloads and keeps the form when someone else changed the objective', async () => {
  const repository = repo(sample())
  render(<LearningObjectives repository={repository} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Edit “Track the jungler”' }))
  // A coach edits it meanwhile.
  await repository.change({
    action: 'update',
    id: 'a',
    revision: 1,
    phase: 'in_game',
    title: 'Track the jungler',
    details: 'From the coach',
  })
  await userEvent.type(screen.getByLabelText('Details'), 'Mine')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed or was removed/)
  expect(screen.getByLabelText('Details')).toHaveValue('Mine')
  await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(2))
})

it('sets the name coaches see', async () => {
  const repository = repo({ playerName: null, objectives: [] })
  render(<LearningObjectives repository={repository} />)
  expect(await screen.findByText(/as “Learning objectives”/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add your name' }))
  await userEvent.type(screen.getByLabelText('Your name for coaches'), 'James')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/as “James’ learning objectives”/)).toBeInTheDocument()
})

it('briefs a coach on arrival, read-only, and skips an empty list', async () => {
  const { unmount } = render(<ObjectivesBriefing repository={repo(sample(), 'coach')} />)
  const dialog = await screen.findByRole('dialog', { name: 'Daniel’s learning objectives' })
  expect(within(dialog).getByText('Track the jungler')).toBeInTheDocument()
  expect(within(dialog).queryByText('Old focus')).toBeNull()
  expect(within(dialog).queryByRole('button', { name: /Edit/ })).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Start reviewing' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  unmount()
  const empty = repo({ playerName: 'Daniel', objectives: [] }, 'coach')
  render(<ObjectivesBriefing repository={empty} />)
  await waitFor(() => expect(empty.load).toHaveBeenCalled())
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('lets a coach edit in the dialog, attributing the player’s own objectives to them', async () => {
  const repository = repo(sample(), 'coach')
  render(<ObjectivesDialog repository={repository} onClose={() => {}} />)
  const dialog = await screen.findByRole('dialog', { name: 'Daniel’s learning objectives' })
  expect(within(dialog).getAllByText(/Added by Daniel/).length).toBeGreaterThan(0)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add post-game objective' }))
  await userEvent.type(within(dialog).getByLabelText('Objective'), 'Reset timings')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Reset timings')).toBeInTheDocument()
})
