import { useEffect, useId, useState, type CSSProperties } from 'react'
import { LoaderCircle } from 'lucide-react'
import { RuneText } from './RunePageEditor'
import {
  atRank,
  formatSeconds,
  hasCooldown,
  ladder,
  loadAbilities,
  withHaste,
  type Ability,
  type ChampionAbilities,
} from '../lib/abilities'

export type CooldownChampion = { id: number; name: string; alias?: string; side: 'them' | 'you' }

// Clean axis steps for seconds: 1, 2, 5 or 10 times a power of ten.
function axis(max: number) {
  const raw = Math.max(max, 1) / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const top = Math.ceil(max / step) * step || step
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
}

function AbilityRow({
  ability,
  rank,
  haste,
  top,
}: {
  ability: Ability
  rank: number
  haste: number
  top: number
}) {
  const [open, setOpen] = useState(false)
  const tipId = useId()
  const timed = hasCooldown(ability)
  const shownRank = Math.min(rank, ability.cooldowns.length)
  const base = atRank(ability, rank)
  const value = withHaste(base, haste)
  const summary = timed
    ? `${ability.key}, ${ability.name}: ${formatSeconds(value)} seconds at rank ${shownRank}${ability.charges ? `, ${ability.charges} charges` : ''}. By rank: ${ladder(ability.cooldowns)} seconds.`
    : `${ability.key}, ${ability.name}: no cooldown.`
  return (
    <div
      className="cooldown-row"
      tabIndex={0}
      aria-label={summary}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <img
        className="cooldown-icon"
        src={ability.icon}
        alt=""
        width={36}
        height={36}
        loading="lazy"
      />
      <div className="cooldown-label">
        <span>
          <b className="cooldown-key">{ability.key}</b>
          {ability.name}
        </span>
        <small>
          {timed && ability.cooldowns.every((c) => c === ability.cooldowns[0]) ? (
            <>
              <span className="current">{formatSeconds(value)}s</span> at every rank
              {ability.charges ? ` · ${ability.charges} charges` : ''}
            </>
          ) : timed ? (
            <>
              {ability.cooldowns.map((c, i) => (
                <span key={i} className={i + 1 === shownRank ? 'current' : ''}>
                  {i > 0 && ' · '}
                  {formatSeconds(withHaste(c, haste))}
                </span>
              ))}
              s{ability.charges ? ` · ${ability.charges} charges` : ''}
            </>
          ) : (
            'No cooldown'
          )}
        </small>
      </div>
      <div className="cooldown-track" aria-hidden>
        {timed && (
          <>
            <span className="cooldown-bar" style={{ width: `${(value / top) * 100}%` }} />
            <span
              className="cooldown-value"
              style={{ '--at': `${(value / top) * 100}%` } as CSSProperties}
            >
              {formatSeconds(value)}s{ability.charges ? <em> between casts</em> : null}
            </span>
          </>
        )}
      </div>
      {open && (
        <div className="cooldown-tooltip" id={tipId} role="tooltip">
          <strong>
            {ability.key} · {ability.name}
          </strong>
          <span>
            <RuneText markup={ability.description} />
          </span>
          {ability.charges && (
            <small>
              Holds {ability.charges} charges. Riot doesn’t publish the recharge time, so the number
              shown is the gap between casts.
            </small>
          )}
        </div>
      )}
    </div>
  )
}

function Group({
  label,
  abilities,
  rank,
  haste,
}: {
  label: string
  abilities: Ability[]
  rank: number
  haste: number
}) {
  // One scale per group, fixed by rank 1 with no haste, so changing the rank or
  // haste visibly shortens the bars instead of rescaling them.
  const { top, ticks } = axis(Math.max(...abilities.map((a) => Math.max(...a.cooldowns))))
  return (
    <div className="cooldown-group" role="group" aria-label={label}>
      <div className="cooldown-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${(t / top) * 100}%` }}>
            {t}s
          </span>
        ))}
      </div>
      <div className="cooldown-rows">
        <div className="cooldown-grid" aria-hidden>
          {ticks.map((t) => (
            <i key={t} style={{ left: `${(t / top) * 100}%` }} />
          ))}
        </div>
        {abilities.map((a) => (
          <AbilityRow key={a.key} ability={a} rank={rank} haste={haste} top={top} />
        ))}
      </div>
    </div>
  )
}

function Segmented({
  label,
  value,
  count,
  onChange,
}: {
  label: string
  value: number
  count: number
  onChange: (n: number) => void
}) {
  return (
    <div className="cooldown-control">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Cooldowns({ champions }: { champions: CooldownChampion[] }) {
  const [who, setWho] = useState(0)
  const [rank, setRank] = useState(1)
  const [ultRank, setUltRank] = useState(1)
  const [haste, setHaste] = useState(0)
  const [data, setData] = useState<ChampionAbilities | null>(null)
  const [failed, setFailed] = useState(false)
  const champion = champions[who]
  useEffect(() => {
    let active = true
    setData(null)
    setFailed(false)
    if (!champion?.alias) {
      setFailed(true)
      return
    }
    loadAbilities(champion.alias)
      .then((d) => active && setData(d))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [champion?.alias])
  if (!champion) return null
  const basics = data?.abilities.filter((a) => a.key !== 'R') ?? []
  const ult = data?.abilities.filter((a) => a.key === 'R') ?? []
  const basicRanks = Math.max(1, ...basics.map((a) => a.cooldowns.length))
  const ultRanks = Math.max(1, ...ult.map((a) => a.cooldowns.length))
  return (
    <section className={`matchup-section cooldowns ${champion.side}`} aria-label="Cooldowns">
      <div className="cooldowns-head">
        <h2>{champion.side === 'them' ? `${champion.name}’s cooldowns` : 'Your cooldowns'}</h2>
        {champions.length > 1 && (
          <div className="segmented" role="group" aria-label="Whose cooldowns">
            {champions.map((c, i) => (
              <button key={c.id} type="button" aria-pressed={who === i} onClick={() => setWho(i)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cooldown-controls">
        <Segmented
          label="Ability rank"
          value={Math.min(rank, basicRanks)}
          count={basicRanks}
          onChange={setRank}
        />
        <Segmented
          label="Ultimate rank"
          value={Math.min(ultRank, ultRanks)}
          count={ultRanks}
          onChange={setUltRank}
        />
        <label className="cooldown-control cooldown-haste">
          <span>
            Ability haste <b>{haste}</b>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={haste}
            onChange={(e) => setHaste(Number(e.target.value))}
          />
        </label>
      </div>
      {failed ? (
        <p className="muted cooldowns-message">
          Couldn’t load {champion.name}’s abilities from Data Dragon.
        </p>
      ) : !data ? (
        <p className="muted cooldowns-message" role="status">
          <LoaderCircle size={14} className="spin" /> Loading abilities…
        </p>
      ) : (
        <>
          <Group label="Basic abilities" abilities={basics} rank={rank} haste={haste} />
          <Group label="Ultimate" abilities={ult} rank={ultRank} haste={haste} />
          <p className="cooldown-passive">
            <img src={data.passive.icon} alt="" width={20} height={20} loading="lazy" />
            <span>
              Passive: <b>{data.passive.name}</b>
            </span>
            <small className="muted">Patch {data.version.split('.').slice(0, 2).join('.')}</small>
          </p>
        </>
      )}
    </section>
  )
}
