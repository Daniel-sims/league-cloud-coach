import { expect, it } from 'vitest'
import { formatLead, leadAt, leadColor } from './PlayerBar'

it('colours the gold lead grey when even, greener ahead and redder behind', () => {
  expect(leadColor(0)).toBe('rgb(110 116 107)')
  expect(leadColor(6000)).toBe('rgb(60 192 90)')
  expect(leadColor(-20000)).toBe('rgb(240 82 72)')
  const green = (lead: number) => Number(leadColor(lead).split(' ')[1])
  expect(green(1000)).toBeGreaterThan(green(0))
  expect(green(3000)).toBeGreaterThan(green(1000))
})

it('reads the lead between minute frames and labels it', () => {
  const points = [
    { ms: 10_000, lead: 0 },
    { ms: 70_000, lead: 600 },
    { ms: 130_000, lead: -1200 },
  ]
  expect(leadAt(points, 5_000)).toBeNull()
  expect(leadAt(points, 140_000)).toBeNull()
  expect(leadAt(points, 10_000)).toBe(0)
  expect(leadAt(points, 40_000)).toBe(300)
  expect(leadAt(points, 130_000)).toBe(-1200)
  expect(formatLead(40)).toBe('Even gold')
  expect(formatLead(640)).toBe('640 gold ahead')
  expect(formatLead(-1240)).toBe('1.2k gold behind')
})
