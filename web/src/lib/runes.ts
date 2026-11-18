// Rune pages, as the League client builds them. Trees, rows, stat shards and
// descriptions come from Community Dragon's copy of the client's own data
// (perkstyles.json, perks.json), so they follow the live patch.

/** Riot's page shape: [keystone, primary ×3, secondary ×2, shards ×3], 0 = empty. */
export type RunePage = { primaryStyleId: number; subStyleId: number; selectedPerkIds: number[] }

export type Perk = { id: number; name: string; shortDesc: string; longDesc: string; icon: string }
export type Slot = { label: string; perks: number[] }
export type Tree = {
  id: number
  name: string
  tooltip: string
  icon: string
  color: string
  /** Row 0 is the keystones, rows 1–3 the regular runes. */
  slots: Slot[]
  subStyles: number[]
  /** Client backdrop art keyed `p{primary}_s{secondary}_k{keystone}` (0 when unset). */
  backdrops: Record<string, string>
}
export type RuneData = { trees: Tree[]; perks: Map<number, Perk>; shards: Slot[] }

const base = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1'
/** Client asset paths ("/lol-game-data/assets/v1/…") on Community Dragon, which lowercases them. */
export const asset = (path: string) =>
  `${base}/${path.replace(/^\/lol-game-data\/assets\/v1\//, '').toLowerCase()}`

// The client's own path colours.
export const treeColors: Record<number, string> = {
  8000: '#c8aa6e', // Precision
  8100: '#d44242', // Domination
  8200: '#9faafc', // Sorcery
  8300: '#49aab9', // Inspiration
  8400: '#a1d586', // Resolve
}
const treeOrder = [8000, 8100, 8200, 8400, 8300]

export const emptyPage = (): RunePage => ({
  primaryStyleId: 0,
  subStyleId: 0,
  selectedPerkIds: [0, 0, 0, 0, 0, 0, 0, 0, 0],
})

type RawStyle = {
  id: number
  name: string
  tooltip: string
  iconPath: string
  allowedSubStyles: number[]
  assetMap: Record<string, string>
  slots: { type: string; slotLabel: string; perks: number[] }[]
}
type RawPerk = { id: number; name: string; shortDesc: string; longDesc: string; iconPath: string }

export function parseRuneData(styles: RawStyle[], perks: RawPerk[]): RuneData {
  const trees = styles
    .filter((s) => treeColors[s.id])
    .sort((a, b) => treeOrder.indexOf(a.id) - treeOrder.indexOf(b.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      tooltip: s.tooltip.trim(),
      icon: asset(s.iconPath),
      color: treeColors[s.id],
      slots: s.slots
        .filter((slot) => slot.type !== 'kStatMod')
        .map((slot) => ({ label: slot.slotLabel, perks: slot.perks })),
      subStyles: s.allowedSubStyles,
      backdrops: Object.fromEntries(
        Object.entries(s.assetMap)
          .filter(([key]) => /^p\d+_s\d+_k\d+$/.test(key))
          .map(([key, path]) => [key, asset(path)]),
      ),
    }))
  // Every tree carries the same shard rows; take them from the first.
  const shards = (styles.find((s) => treeColors[s.id])?.slots ?? [])
    .filter((slot) => slot.type === 'kStatMod')
    .map((slot) => ({ label: slot.slotLabel, perks: slot.perks }))
  const used = new Set([...trees.flatMap((t) => t.slots), ...shards].flatMap((s) => s.perks))
  return {
    trees,
    shards,
    perks: new Map(
      perks
        .filter((p) => used.has(p.id))
        .map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            shortDesc: p.shortDesc,
            longDesc: p.longDesc,
            icon: asset(p.iconPath),
          },
        ]),
    ),
  }
}

let pending: Promise<RuneData> | undefined
export function loadRuneData(): Promise<RuneData> {
  pending ??= Promise.all([
    fetch(`${base}/perkstyles.json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
    fetch(`${base}/perks.json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
  ])
    .then(([styles, perks]) => parseRuneData(styles.styles, perks))
    .catch((error) => {
      pending = undefined
      throw error
    })
  return pending
}

const copy = (page: RunePage): RunePage => ({ ...page, selectedPerkIds: [...page.selectedPerkIds] })

/** Choosing a path resets its runes; the secondary can't share it. Shards stay. */
export function choosePrimary(page: RunePage, treeId: number): RunePage {
  if (page.primaryStyleId === treeId) return page
  const next = copy(page)
  next.primaryStyleId = treeId
  next.selectedPerkIds.splice(0, 4, 0, 0, 0, 0)
  if (next.subStyleId === treeId) {
    next.subStyleId = 0
    next.selectedPerkIds.splice(4, 2, 0, 0)
  }
  return next
}

export function chooseSecondary(page: RunePage, treeId: number): RunePage {
  if (page.subStyleId === treeId || page.primaryStyleId === treeId) return page
  const next = copy(page)
  next.subStyleId = treeId
  next.selectedPerkIds.splice(4, 2, 0, 0)
  return next
}

/** Row 0 is the keystone, rows 1–3 the primary runes. */
export function choosePrimaryRune(page: RunePage, row: number, perkId: number): RunePage {
  const next = copy(page)
  next.selectedPerkIds[row] = perkId
  return next
}

/**
 * Two runes from different rows of the secondary path, as in the client: a
 * pick in a row you already used swaps it; a pick in a third row drops the
 * older of the two.
 */
export function chooseSecondaryRune(page: RunePage, tree: Tree, perkId: number): RunePage {
  const rowOf = (id: number) => tree.slots.findIndex((s, i) => i > 0 && s.perks.includes(id))
  const row = rowOf(perkId)
  if (row < 1) return page
  const picks = page.selectedPerkIds.slice(4, 6).filter((id) => id && rowOf(id) > 0)
  if (picks.includes(perkId)) return page
  const same = picks.findIndex((id) => rowOf(id) === row)
  if (same >= 0) picks[same] = perkId
  else {
    if (picks.length === 2) picks.shift()
    picks.push(perkId)
  }
  const next = copy(page)
  next.selectedPerkIds.splice(4, 2, picks[0] ?? 0, picks[1] ?? 0)
  return next
}

export function chooseShard(page: RunePage, row: number, perkId: number): RunePage {
  const next = copy(page)
  next.selectedPerkIds[6 + row] = perkId
  return next
}

export const isEmpty = (page: RunePage | null | undefined) =>
  !page || (!page.primaryStyleId && !page.subStyleId && page.selectedPerkIds.every((id) => !id))

export const isComplete = (page: RunePage) =>
  Boolean(page.primaryStyleId && page.subStyleId) && page.selectedPerkIds.every(Boolean)

/** Background art for the page, falling back to the path's art without a secondary or keystone. */
export function backdrop(tree: Tree | undefined, page: RunePage) {
  if (!tree) return undefined
  const k = page.selectedPerkIds[0]
  return (
    tree.backdrops[`p${tree.id}_s${page.subStyleId}_k${k}`] ??
    tree.backdrops[`p${tree.id}_s0_k${k}`] ??
    tree.backdrops[`p${tree.id}_s${page.subStyleId}_k0`] ??
    tree.backdrops[`p${tree.id}_s0_k0`]
  )
}

type MatchPerks = {
  statPerks?: { offense?: number; flex?: number; defense?: number }
  styles?: { style?: number; selections?: { perk: number }[] }[]
}
/** The page a synced game was played with (match-v5 `perks`). */
export function pageFromMatch(perks: MatchPerks | undefined): RunePage | null {
  const [primary, secondary] = perks?.styles ?? []
  if (!primary?.style || !secondary?.style) return null
  const pick = (list: { perk: number }[] | undefined, n: number) =>
    Array.from({ length: n }, (_, i) => list?.[i]?.perk ?? 0)
  return {
    primaryStyleId: primary.style,
    subStyleId: secondary.style,
    selectedPerkIds: [
      ...pick(primary.selections, 4),
      ...pick(secondary.selections, 2),
      perks?.statPerks?.offense ?? 0,
      perks?.statPerks?.flex ?? 0,
      perks?.statPerks?.defense ?? 0,
    ],
  }
}

export type RuneTextNode =
  | string
  | { tag: 'br' }
  | { tag: 'hr' }
  | { tag: 'li' }
  | { tag: 'b' | 'i' | 'span'; className?: string; color?: string; children: RuneTextNode[] }

/**
 * Riot's descriptions are client markup (<br>, <li>, <font color>, keyword and
 * scaling tags). This turns them into a small tree of allowed nodes so they can
 * render as React elements: nothing is ever inserted as HTML.
 */
export function parseRuneText(markup: string): RuneTextNode[] {
  const root: RuneTextNode[] = []
  const stack: { tag: string; children: RuneTextNode[] }[] = [{ tag: '', children: root }]
  const decode = (text: string) =>
    text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  for (const token of markup.split(/(<[^>]*>)/)) {
    if (!token) continue
    const top = stack[stack.length - 1]
    const tag = token.match(/^<\s*(\/?)\s*([a-zA-Z][\w-]*)([^>]*)>$/)
    if (!tag) {
      top.children.push(decode(token))
      continue
    }
    const [, closing, rawName, attrs] = tag
    const name = rawName.toLowerCase()
    if (name === 'br' || name === 'hr' || name === 'li') {
      if (!closing) top.children.push({ tag: name })
      continue
    }
    if (closing) {
      const at = stack.map((s) => s.tag).lastIndexOf(name)
      if (at > 0) stack.length = at
      continue
    }
    const color =
      name === 'font' ? attrs.match(/color\s*=\s*['"]?(#[0-9a-fA-F]{6})/)?.[1] : undefined
    const node: RuneTextNode =
      name === 'b' || name === 'i'
        ? { tag: name, children: [] }
        : {
            tag: 'span',
            className: name === 'font' ? undefined : `rune-${name.replace(/[^a-z-]/g, '')}`,
            color,
            children: [],
          }
    top.children.push(node)
    stack.push({ tag: name, children: node.children })
  }
  return root
}
