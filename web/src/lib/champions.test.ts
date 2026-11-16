import { expect, it } from 'vitest'
import { championLabel } from './champions'

it('turns Riot champion keys into the names players know', () => {
  expect(championLabel('TwistedFate')).toBe('Twisted Fate')
  expect(championLabel('MonkeyKing')).toBe('Wukong')
  expect(championLabel('Chogath')).toBe("Cho'Gath")
  expect(championLabel('Leblanc')).toBe('LeBlanc')
  expect(championLabel('JarvanIV')).toBe('Jarvan IV')
  expect(championLabel('Ahri')).toBe('Ahri')
  expect(championLabel('')).toBe('')
  expect(championLabel(undefined)).toBe('')
})

it('leaves an already friendly name unchanged', () => {
  for (const name of ['Twisted Fate', 'LeBlanc', "Kai'Sa", 'Dr. Mundo', 'Jarvan IV', 'Wukong'])
    expect(championLabel(name)).toBe(name)
})
