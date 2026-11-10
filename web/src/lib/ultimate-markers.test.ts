import { expect, it } from 'vitest'
import { ultimateEntries, type ReviewPayload } from './review-timeline'

it('keeps ultimate timestamps tied to the original video when game sync changes', () => {
  const payload = {
    ultimates: { detectorVersion: 1, videoTimestampsMs: [10000, 10000, 20000, 0] },
  } as ReviewPayload
  expect(ultimateEntries(payload, null)).toEqual([])
  const entries = ultimateEntries(payload, { gameTimeSeconds: 0, videoOffsetSeconds: 5 })
  expect(entries.map((e) => e.gameTimeMs)).toEqual([5000, 15000])
  expect(entries.map((e) => e.kind)).toEqual(['ultimate', 'ultimate'])
  expect(
    ultimateEntries(payload, { gameTimeSeconds: 0, videoOffsetSeconds: 10 }).map(
      (e) => e.gameTimeMs,
    ),
  ).toEqual([10000])
})
