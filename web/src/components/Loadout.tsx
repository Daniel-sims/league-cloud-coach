import { useEffect, useState } from 'react'
import type { Participant } from '../lib/league'

type Asset = { name: string; url: string }
type Assets = {
  spells: Record<number, Asset>
  runes: Record<number, Asset>
  items: Record<number, string>
}
const empty: Assets = { spells: {}, runes: {}, items: {} }
let pending: Promise<Assets> | undefined
async function catalogue(): Promise<Assets> {
  const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json())
  const base = `https://ddragon.leagueoflegends.com/cdn/${versions[0]}`
  const [spells, runes, items] = await Promise.all([
    fetch(`${base}/data/en_US/summoner.json`, { signal: AbortSignal.timeout(5000) }).then((r) =>
      r.json(),
    ),
    fetch(`${base}/data/en_US/runesReforged.json`, { signal: AbortSignal.timeout(5000) }).then(
      (r) => r.json(),
    ),
    fetch(`${base}/data/en_US/item.json`, { signal: AbortSignal.timeout(5000) }).then((r) =>
      r.json(),
    ),
  ])
  const assets: Assets = { spells: {}, runes: {}, items: {} }
  for (const [id, item] of Object.entries(items.data) as [string, { name: string }][])
    assets.items[Number(id)] = item.name
  for (const s of Object.values(spells.data) as {
    key: string
    name: string
    image: { full: string }
  }[])
    assets.spells[Number(s.key)] = { name: s.name, url: `${base}/img/spell/${s.image.full}` }
  for (const style of runes as {
    id: number
    name: string
    icon: string
    slots: { runes: { id: number; name: string; icon: string }[] }[]
  }[]) {
    for (const rune of [style, ...style.slots.flatMap((slot) => slot.runes)])
      assets.runes[rune.id] = {
        name: rune.name,
        url: `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`,
      }
  }
  return assets
}
function useAssets() {
  const [assets, setAssets] = useState(empty)
  useEffect(() => {
    let active = true
    pending ??= catalogue().catch(() => empty)
    void pending.then((a) => {
      if (active) setAssets(a)
    })
    return () => {
      active = false
    }
  }, [])
  return assets
}
export function Loadout({ player }: { player: Participant }) {
  const assets = useAssets()
  const keystone = player.perks?.styles[0]?.selections[0]?.perk
  const secondary = (player.perks?.styles[1] as { style?: number } | undefined)?.style
  const icons = [
    assets.spells[player.summoner1Id],
    assets.spells[player.summoner2Id],
    keystone ? assets.runes[keystone] : undefined,
    secondary ? assets.runes[secondary] : undefined,
  ]
  return (
    <div className="league-loadout" aria-label="Summoner spells and runes">
      {icons.map((asset, i) =>
        asset ? (
          <img
            key={i}
            src={asset.url}
            width={18}
            height={18}
            alt={asset.name}
            title={asset.name}
            loading="lazy"
          />
        ) : (
          <span
            key={i}
            className="league-empty-item"
            title={
              i < 2 ? `Summoner spell ${i === 0 ? player.summoner1Id : player.summoner2Id}` : 'Rune'
            }
          />
        ),
      )}
    </div>
  )
}

export function ItemBuild({
  player: p,
  version,
  size = 22,
}: {
  player: Participant
  version: string
  size?: number
}) {
  const assets = useAssets()
  const patch = version.split('.').slice(0, 2).join('.') + '.1'
  return (
    <div className="league-items" style={{ '--item-size': `${size}px` } as React.CSSProperties}>
      {[p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map((id, i) =>
        id ? (
          <img
            key={i}
            width={size}
            height={size}
            loading="lazy"
            alt={assets.items[id] ?? `Item ${id}`}
            title={assets.items[id] ?? `Item ${id}`}
            src={`https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${id}.png`}
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <span key={i} className="league-empty-item" />
        ),
      )}
    </div>
  )
}
