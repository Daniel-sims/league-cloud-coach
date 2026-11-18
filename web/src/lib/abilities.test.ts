import { expect, it } from 'vitest'
import { atRank, formatSeconds, hasCooldown, ladder, parseAbilities, withHaste } from './abilities'
import zed from '../../e2e/fixtures/champion-Zed.json'
import corki from '../../e2e/fixtures/champion-Corki.json'

it('reads Q, W, E and R cooldowns by rank, with icons for the patch', () => {
  const data = parseAbilities(zed, 'Zed', '16.23.1')
  expect(data.abilities.map((a) => [a.key, a.name, a.cooldowns])).toEqual([
    ['Q', 'Razor Shuriken', [6, 6, 6, 6, 6]],
    ['W', 'Living Shadow', [20, 19, 18, 17, 16]],
    ['E', 'Shadow Slash', [5, 4.5, 4, 3.5, 3]],
    ['R', 'Death Mark', [120, 110, 100]],
  ])
  expect(data.abilities[0].icon).toBe(
    'https://ddragon.leagueoflegends.com/cdn/16.23.1/img/spell/ZedQ.png',
  )
  expect(data.passive.name).toBe('Contempt for the Weak')
  expect(data.abilities.every((a) => a.charges === null)).toBe(true)
})

it('flags ammo abilities, whose number is the gap between casts', () => {
  const r = parseAbilities(corki, 'Corki', '16.23.1').abilities[3]
  expect(r.charges).toBe(4)
})

it('applies ability haste and clamps ranks', () => {
  expect(withHaste(20, 0)).toBe(20)
  expect(withHaste(20, 100)).toBe(10)
  expect(withHaste(12, 20)).toBe(10)
  const r = parseAbilities(zed, 'Zed', '16.23.1').abilities[3]
  expect(atRank(r, 5)).toBe(100) // only three ranks
  expect(atRank(r, 0)).toBe(120)
  expect(hasCooldown(r)).toBe(true)
  expect(hasCooldown({ ...r, cooldowns: [0, 0, 0] })).toBe(false)
})

it('writes cooldown ladders compactly', () => {
  expect(ladder([6, 6, 6, 6, 6])).toBe('6')
  expect(ladder([5, 4.5, 4, 3.5, 3])).toBe('5 · 4.5 · 4 · 3.5 · 3')
  expect(formatSeconds(8.333)).toBe('8.33')
  expect(formatSeconds(16.66)).toBe('16.7')
})

it('rejects champion files without four abilities', () => {
  expect(() => parseAbilities({ data: {} }, 'Nobody', '1')).toThrow()
})
