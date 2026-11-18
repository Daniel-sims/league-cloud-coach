import { expect, it } from 'vitest'
import { formatSeconds, parseAbilities } from './abilities'
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

it('formats seconds compactly', () => {
  expect(formatSeconds(6)).toBe('6')
  expect(formatSeconds(4.5)).toBe('4.5')
  expect(formatSeconds(8.333)).toBe('8.33')
})

it('flags ammo abilities, whose number is the gap between casts', () => {
  const r = parseAbilities(corki, 'Corki', '16.23.1').abilities[3]
  expect(r.charges).toBe(4)
})

it('rejects champion files without four abilities', () => {
  expect(() => parseAbilities({ data: {} }, 'Nobody', '1')).toThrow()
})
