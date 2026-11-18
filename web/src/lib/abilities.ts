// Champion ability cooldowns from Data Dragon (the per-champion files the game
// client publishes each patch). Checked against Community Dragon's game files.
// Data Dragon flags ammo abilities but doesn't publish their recharge time, so
// for those the number is the gap between casts.

export type Ability = {
  key: 'Q' | 'W' | 'E' | 'R'
  name: string
  description: string
  icon: string
  /** Seconds per rank; all zero for abilities with no cooldown. */
  cooldowns: number[]
  /** Charges, for ammo abilities. */
  charges: number | null
}
export type ChampionAbilities = {
  alias: string
  version: string
  passive: { name: string; description: string; icon: string }
  abilities: Ability[]
}

type RawSpell = {
  name: string
  description: string
  cooldown: number[]
  maxrank: number
  maxammo?: string
  image: { full: string }
}
type RawChampion = {
  data: Record<
    string,
    {
      spells: RawSpell[]
      passive: { name: string; description: string; image: { full: string } }
    }
  >
}

const cdn = 'https://ddragon.leagueoflegends.com/cdn'

export function parseAbilities(
  json: RawChampion,
  alias: string,
  version: string,
): ChampionAbilities {
  const champion = json.data[alias] ?? Object.values(json.data)[0]
  if (!champion || champion.spells.length < 4) throw new Error('Incomplete champion data')
  return {
    alias,
    version,
    passive: {
      name: champion.passive.name,
      description: champion.passive.description,
      icon: `${cdn}/${version}/img/passive/${champion.passive.image.full}`,
    },
    abilities: champion.spells.slice(0, 4).map((s, i) => {
      const ammo = Number(s.maxammo)
      return {
        key: (['Q', 'W', 'E', 'R'] as const)[i],
        name: s.name,
        description: s.description,
        icon: `${cdn}/${version}/img/spell/${s.image.full}`,
        cooldowns: s.cooldown.slice(0, Math.max(1, s.maxrank)),
        charges: ammo > 0 ? ammo : null,
      }
    }),
  }
}

/** Cooldown after ability haste: base × 100 / (100 + haste). */
export const withHaste = (seconds: number, haste: number) =>
  (seconds * 100) / (100 + Math.max(0, haste))

/** The cooldown at a rank, clamped to the ability's ranks (1-based). */
export const atRank = (ability: Ability, rank: number) =>
  ability.cooldowns[Math.min(Math.max(rank, 1), ability.cooldowns.length) - 1] ?? 0

export const hasCooldown = (ability: Ability) => ability.cooldowns.some((s) => s > 0)

/** "20 · 19 · 18 · 17 · 16", or one number when every rank is the same. */
export const ladder = (cooldowns: number[]) =>
  cooldowns.every((s) => s === cooldowns[0])
    ? formatSeconds(cooldowns[0])
    : cooldowns.map(formatSeconds).join(' · ')

export const formatSeconds = (seconds: number) =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: seconds < 10 ? 2 : 1 }).format(seconds)

let version: Promise<string> | undefined
const cache = new Map<string, Promise<ChampionAbilities>>()
export function loadAbilities(alias: string): Promise<ChampionAbilities> {
  if (!/^[A-Za-z0-9]{1,40}$/.test(alias)) return Promise.reject(new Error('Unknown champion'))
  version ??= fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => r.json())
    .then((list: string[]) => list[0])
    .catch((e) => {
      version = undefined
      throw e
    })
  let pending = cache.get(alias)
  if (!pending) {
    pending = version
      .then((v) =>
        fetch(`${cdn}/${v}/data/en_US/champion/${alias}.json`, {
          signal: AbortSignal.timeout(8000),
        })
          .then((r) => {
            if (!r.ok) throw new Error('Champion data unavailable')
            return r.json()
          })
          .then((json) => parseAbilities(json, alias, v)),
      )
      .catch((e) => {
        cache.delete(alias)
        throw e
      })
    cache.set(alias, pending)
  }
  return pending
}
