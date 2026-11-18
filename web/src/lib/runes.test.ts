import { expect, it } from 'vitest'
import {
  asset,
  backdrop,
  choosePrimary,
  choosePrimaryRune,
  chooseSecondary,
  chooseSecondaryRune,
  chooseShard,
  emptyPage,
  isComplete,
  isEmpty,
  pageFromMatch,
  parseRuneData,
  parseRuneText,
} from './runes'

// A trimmed copy of Community Dragon's perkstyles.json / perks.json shapes.
const shardSlots = [
  { type: 'kStatMod', slotLabel: 'Offense', perks: [5008, 5005, 5007] },
  { type: 'kStatMod', slotLabel: 'Flex', perks: [5008, 5010, 5001] },
  { type: 'kStatMod', slotLabel: 'Defense', perks: [5011, 5013, 5001] },
]
const style = (id: number, name: string, base: number) => ({
  id,
  name,
  tooltip: `${name} tooltip `,
  iconPath: `/lol-game-data/assets/v1/perk-images/Styles/${name}.png`,
  allowedSubStyles: [],
  assetMap: {
    [`p${id}_s0_k0`]: `/lol-game-data/assets/v1/perk-images/Styles/${name}/p${id}_s0_k0.jpg`,
    [`p${id}_s8200_k${base}`]: `/lol-game-data/assets/v1/perk-images/Styles/${name}/p${id}_s8200_k${base}.jpg`,
    svg_icon: 'ignored.svg',
  },
  slots: [
    { type: 'kKeyStone', slotLabel: '', perks: [base, base + 1] },
    { type: 'kMixedRegularSplashable', slotLabel: 'A', perks: [base + 10, base + 11, base + 12] },
    { type: 'kMixedRegularSplashable', slotLabel: 'B', perks: [base + 20, base + 21, base + 22] },
    { type: 'kMixedRegularSplashable', slotLabel: 'C', perks: [base + 30, base + 31, base + 32] },
    ...shardSlots,
  ],
})
const ids = [8000, 8001, 8010, 8011, 8012, 8020, 8021, 8022, 8030, 8031, 8032]
const perks = [
  ...ids,
  ...ids.map((i) => i + 200),
  5008,
  5005,
  5007,
  5010,
  5001,
  5011,
  5013,
  9999,
].map((id) => ({
  id,
  name: `Perk ${id}`,
  shortDesc: 'short',
  longDesc: 'long',
  iconPath: `/lol-game-data/assets/v1/perk-images/X/${id}.png`,
}))
const data = parseRuneData(
  [
    style(8200, 'Sorcery', 8200),
    style(8000, 'Precision', 8000),
    { ...style(7000, 'Unknown', 7000) },
  ],
  perks,
)
const precision = data.trees.find((t) => t.id === 8000)!
const sorcery = data.trees.find((t) => t.id === 8200)!

it('reads trees in client order, splits shard rows and keeps only used perks', () => {
  expect(data.trees.map((t) => t.name)).toEqual(['Precision', 'Sorcery'])
  expect(precision.slots).toHaveLength(4)
  expect(precision.tooltip).toBe('Precision tooltip')
  expect(data.shards.map((s) => s.label)).toEqual(['Offense', 'Flex', 'Defense'])
  expect(data.perks.has(9999)).toBe(false)
  expect(data.perks.get(8000)!.icon).toBe(
    'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/x/8000.png',
  )
  expect(Object.keys(precision.backdrops)).not.toContain('svg_icon')
})

it('picks primary runes one per row and resets them when the path changes', () => {
  let page = choosePrimary(emptyPage(), 8000)
  page = choosePrimaryRune(page, 0, 8000)
  page = choosePrimaryRune(page, 1, 8011)
  page = choosePrimaryRune(page, 1, 8012)
  expect(page.selectedPerkIds.slice(0, 4)).toEqual([8000, 8012, 0, 0])
  page = chooseShard(page, 2, 5013)
  page = chooseSecondary(page, 8200)
  page = chooseSecondaryRune(page, sorcery, 8210)
  // Changing primary to the current secondary clears both; shards stay.
  const swapped = choosePrimary(page, 8200)
  expect(swapped).toMatchObject({ primaryStyleId: 8200, subStyleId: 0 })
  expect(swapped.selectedPerkIds).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 5013])
  expect(chooseSecondary(page, 8000)).toBe(page) // can't splash your primary
})

it('keeps two secondary runes from different rows, like the client', () => {
  let page = chooseSecondary(choosePrimary(emptyPage(), 8000), 8200)
  page = chooseSecondaryRune(page, sorcery, 8210) // row A
  page = chooseSecondaryRune(page, sorcery, 8221) // row B
  expect(page.selectedPerkIds.slice(4, 6)).toEqual([8210, 8221])
  page = chooseSecondaryRune(page, sorcery, 8212) // row A again: swaps that row
  expect(page.selectedPerkIds.slice(4, 6)).toEqual([8212, 8221])
  page = chooseSecondaryRune(page, sorcery, 8230) // third row: the older pick goes
  expect(page.selectedPerkIds.slice(4, 6)).toEqual([8221, 8230])
  expect(chooseSecondaryRune(page, sorcery, 8200)).toBe(page) // keystones can't be splashed
})

it('knows empty and complete pages, and finds the client backdrop', () => {
  expect(isEmpty(emptyPage())).toBe(true)
  expect(isEmpty(null)).toBe(true)
  const full = {
    primaryStyleId: 8000,
    subStyleId: 8200,
    selectedPerkIds: [8000, 8010, 8020, 8030, 8210, 8220, 5008, 5010, 5011],
  }
  expect(isComplete(full)).toBe(true)
  expect(backdrop(precision, full)).toMatch(/p8000_s8200_k8000\.jpg$/)
  expect(
    backdrop(precision, { ...full, selectedPerkIds: [8001, ...full.selectedPerkIds.slice(1)] }),
  ).toMatch(/p8000_s0_k0\.jpg$/)
  expect(asset('/lol-game-data/assets/v1/A/B.PNG')).toMatch(/\/v1\/a\/b\.png$/)
})

it('reads the page a synced game was played with', () => {
  expect(
    pageFromMatch({
      statPerks: { offense: 5005, flex: 5008, defense: 5011 },
      styles: [
        {
          style: 8000,
          selections: [{ perk: 8005 }, { perk: 9111 }, { perk: 9104 }, { perk: 8299 }],
        },
        { style: 8200, selections: [{ perk: 8226 }, { perk: 8237 }] },
      ],
    }),
  ).toEqual({
    primaryStyleId: 8000,
    subStyleId: 8200,
    selectedPerkIds: [8005, 9111, 9104, 8299, 8226, 8237, 5005, 5008, 5011],
  })
  expect(pageFromMatch(undefined)).toBeNull()
  expect(pageFromMatch({ styles: [{ style: 8000 }] })).toBeNull()
})

it('parses client markup into safe nodes', () => {
  const nodes = parseRuneText(
    "Deals <scaleAD>40 - 160</scaleAD> <lol-uikit-tooltipped-keyword key='x'><font color='#48C4B7'>adaptive</font></lol-uikit-tooltipped-keyword>.<br><li>One<li>Two<rules><i>Ranged:</i> 40%</rules> &amp; <img src=x onerror=alert(1)><font color='red;background:url(x)'>x</font>",
  )
  expect(nodes[0]).toBe('Deals ')
  expect(nodes[1]).toEqual({
    tag: 'span',
    className: 'rune-scalead',
    color: undefined,
    children: ['40 - 160'],
  })
  expect(nodes[3]).toEqual({
    tag: 'span',
    className: 'rune-lol-uikit-tooltipped-keyword',
    color: undefined,
    children: [{ tag: 'span', className: undefined, color: '#48C4B7', children: ['adaptive'] }],
  })
  expect(nodes).toContainEqual({ tag: 'br' })
  expect(nodes.filter((n) => typeof n === 'object' && n.tag === 'li')).toHaveLength(2)
  const json = JSON.stringify(nodes)
  expect(json).toContain('&') // entity decoded to text
  expect(json).not.toContain('onerror') // unknown tags carry no attributes
  expect(json).not.toContain('background') // only plain hex colours survive
})
