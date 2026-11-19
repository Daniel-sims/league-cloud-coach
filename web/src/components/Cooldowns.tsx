import { useEffect, useState } from 'react'
import { formatSeconds, loadAbilities, type ChampionAbilities } from '../lib/abilities'

export type CooldownChampion = { id: number; name: string; alias?: string }

// The lane opponent's cooldowns per rank, as a plain table.
export function Cooldowns({ champion }: { champion: CooldownChampion }) {
  const [data, setData] = useState<ChampionAbilities | null>(null)
  useEffect(() => {
    let active = true
    if (champion.alias)
      loadAbilities(champion.alias)
        .then((d) => active && setData(d))
        .catch(() => undefined)
    return () => {
      active = false
    }
  }, [champion.alias])
  if (!data) return null
  const ranks = Math.max(...data.abilities.map((a) => a.cooldowns.length))
  return (
    <section className="matchup-section cooldowns" aria-label="Cooldowns">
      <h2>
        {champion.name}’s cooldowns <small>seconds</small>
      </h2>
      <table className="cooldown-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            {Array.from({ length: ranks }, (_, i) => (
              <th key={i} scope="col" aria-label={`Rank ${i + 1}`}>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.abilities.map((a) => (
            <tr key={a.key}>
              <th scope="row">
                <img src={a.icon} alt="" width={20} height={20} loading="lazy" />
                <b>{a.key}</b>
                <span>
                  {a.name}
                  {/* Riot doesn't publish ammo recharge times; the numbers are between casts. */}
                  {a.charges ? <small> · {a.charges} charges</small> : null}
                </span>
              </th>
              {a.cooldowns.every((s) => s === 0) ? (
                <td colSpan={ranks} className="muted">
                  No cooldown
                </td>
              ) : (
                Array.from({ length: ranks }, (_, i) => (
                  <td key={i}>
                    {a.cooldowns[i] === undefined ? '' : formatSeconds(a.cooldowns[i])}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
