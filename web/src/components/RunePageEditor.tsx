import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { LayoutGrid, List, LoaderCircle, RotateCcw } from 'lucide-react'
import {
  backdrop,
  choosePrimary,
  choosePrimaryRune,
  chooseSecondary,
  chooseSecondaryRune,
  chooseShard,
  emptyPage,
  isEmpty,
  loadRuneData,
  pageFromMatch,
  parseRuneText,
  type RuneData,
  type RunePage,
  type RuneTextNode,
  type Tree,
} from '../lib/runes'
import type { Game } from '../lib/league'
import '../runes.css'

export function RuneText({ markup }: { markup: string }) {
  const render = (nodes: RuneTextNode[]): ReactNode[] =>
    nodes.map((node, i) => {
      if (typeof node === 'string') return node
      if (node.tag === 'br') return <br key={i} />
      if (node.tag === 'hr') return <hr key={i} />
      if (node.tag === 'li')
        return (
          <span key={i} className="rune-li">
            <br />•{' '}
          </span>
        )
      if (node.tag === 'b') return <strong key={i}>{render(node.children)}</strong>
      if (node.tag === 'i') return <em key={i}>{render(node.children)}</em>
      return (
        <span
          key={i}
          className={node.className}
          style={node.color ? { color: node.color } : undefined}
        >
          {render(node.children)}
        </span>
      )
    })
  return <>{render(parseRuneText(markup))}</>
}

function useShiftHeld() {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Shift' && setHeld(true)
    const up = (e: KeyboardEvent) => e.key === 'Shift' && setHeld(false)
    const blur = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return held
}

type Tip = { title: string; icon: string; body: string; detail: string; left: number; top: number }

const dateLabel = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function RunePageEditor({
  value,
  onChange,
  games = [],
}: {
  value: RunePage | null
  onChange: (page: RunePage | null) => void
  /** Games to copy a page from, newest first. */
  games?: Game[]
}) {
  const [data, setData] = useState<RuneData | null>(null)
  const [failed, setFailed] = useState(false)
  const [detailed, setDetailed] = useState(false)
  const [always, setAlways] = useState(false)
  const [tip, setTip] = useState<Tip | null>(null)
  const shift = useShiftHeld()
  const tipId = useId()
  useEffect(() => {
    let active = true
    loadRuneData()
      .then((d) => active && setData(d))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [tip])

  if (failed)
    return (
      <div className="rune-page rune-page-message">
        Couldn’t load the rune list from Community Dragon. Your saved page is kept.
      </div>
    )
  if (!data)
    return (
      <div className="rune-page rune-page-message" role="status">
        <LoaderCircle size={16} className="spin" /> Loading runes…
      </div>
    )

  const page = value ?? emptyPage()
  const ids = page.selectedPerkIds
  const primary = data.trees.find((t) => t.id === page.primaryStyleId)
  const secondary = data.trees.find((t) => t.id === page.subStyleId)
  const perk = (id: number) => data.perks.get(id)
  const set = (next: RunePage) => onChange(isEmpty(next) ? null : next)
  const showDetail = always || shift

  const show = (target: HTMLElement, title: string, icon: string, body: string, detail: string) => {
    const r = target.getBoundingClientRect()
    const width = 320
    const left =
      r.right + 12 + width > window.innerWidth ? Math.max(8, r.left - 12 - width) : r.right + 12
    const top = Math.min(Math.max(8, r.top - 8), window.innerHeight - 220)
    setTip({ title, icon, body, detail, left, top })
  }
  const tipHandlers = (title: string, icon: string, body: string, detail = body) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
      show(e.currentTarget, title, icon, body, detail),
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget, title, icon, body, detail),
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
    'aria-describedby': tip?.title === title ? tipId : undefined,
  })

  const option = (
    id: number,
    kind: 'keystone' | 'rune' | 'shard',
    selected: boolean,
    choose: () => void,
  ) => {
    const p = perk(id)
    if (!p) return null
    return (
      <button
        key={id}
        type="button"
        className={`rune-option ${kind} ${selected ? 'selected' : ''}`}
        aria-pressed={selected}
        aria-label={p.name}
        onClick={choose}
        {...tipHandlers(p.name, p.icon, p.shortDesc, p.longDesc)}
      >
        <img src={p.icon} alt="" width={64} height={64} loading="lazy" />
      </button>
    )
  }
  const detail = (id: number) => {
    const p = perk(id)
    if (!detailed || !p) return null
    return (
      <div className="rune-detail">
        <strong>{p.name}</strong>
        <span>
          <RuneText markup={p.shortDesc} />
        </span>
      </div>
    )
  }

  const treePicker = (
    current: Tree | undefined,
    choices: Tree[],
    pick: (tree: Tree) => void,
    label: string,
    disabled = false,
  ) => (
    <div className="rune-tree-head" role="group" aria-label={label}>
      <span className={`rune-emblem ${current ? '' : 'empty'}`} aria-hidden>
        {current && <img src={current.icon} alt="" />}
      </span>
      <div className="rune-tree-choices">
        {choices.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rune-tree-choice ${t.id === current?.id ? 'selected' : ''}`}
            style={{ '--choice': t.color } as CSSProperties}
            aria-pressed={t.id === current?.id}
            aria-label={`${label}: ${t.name}`}
            disabled={disabled}
            onClick={() => pick(t)}
            {...tipHandlers(t.name, t.icon, t.tooltip)}
          >
            <img src={t.icon} alt="" />
          </button>
        ))}
      </div>
    </div>
  )

  const art = backdrop(primary, page)
  const copyable = games
    .map((g) => ({ g, page: pageFromMatch(g.player.perks as Parameters<typeof pageFromMatch>[0]) }))
    .filter((x): x is { g: Game; page: RunePage } => x.page !== null)
    .slice(0, 20)

  return (
    <div
      className="rune-page"
      style={
        {
          '--tree': primary?.color ?? '#c8aa6e',
          '--sub': secondary?.color ?? '#c8aa6e',
        } as CSSProperties
      }
    >
      {art && <img className="rune-backdrop" src={art} alt="" aria-hidden />}
      <div className="rune-toolbar">
        <div className="rune-view" role="group" aria-label="Rune view">
          <button
            type="button"
            aria-pressed={!detailed}
            aria-label="Icons only"
            title="Icons only"
            onClick={() => setDetailed(false)}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            aria-pressed={detailed}
            aria-label="Names and descriptions"
            title="Names and descriptions"
            onClick={() => setDetailed(true)}
          >
            <List size={14} />
          </button>
        </div>
        {copyable.length > 0 && (
          <select
            className="rune-copy"
            aria-label="Copy runes from a game"
            value=""
            onChange={(e) => {
              const chosen = copyable[Number(e.target.value)]
              if (chosen) set(chosen.page)
            }}
          >
            <option value="">Copy from a game…</option>
            {copyable.map(({ g, page: p }, i) => (
              <option key={g.id} value={i}>
                {dateLabel(g.gameCreation)} · {g.player.win ? 'Win' : 'Loss'} ·{' '}
                {perk(p.selectedPerkIds[0])?.name ?? 'Unknown keystone'} · {g.player.kills}/
                {g.player.deaths}/{g.player.assists}
              </option>
            ))}
          </select>
        )}
        {!isEmpty(page) && (
          <button type="button" className="rune-reset" onClick={() => onChange(null)}>
            <RotateCcw size={13} /> Clear
          </button>
        )}
      </div>

      <div className="rune-columns">
        <section className="rune-tree primary" aria-label="Primary path">
          {treePicker(primary, data.trees, (t) => set(choosePrimary(page, t.id)), 'Primary path')}
          {primary ? (
            <div className="rune-rows">
              {primary.slots.map((slot, row) => (
                <div
                  key={row}
                  className={`rune-row ${row === 0 ? 'keystones' : ''}`}
                  role="group"
                  aria-label={row === 0 ? 'Keystone' : slot.label || `Row ${row}`}
                >
                  {row === 0 && <span className="rune-row-label">Keystones</span>}
                  <span className={`rune-node ${ids[row] ? 'filled' : ''}`} aria-hidden />
                  <div className="rune-options">
                    {slot.perks.map((id) =>
                      option(id, row === 0 ? 'keystone' : 'rune', ids[row] === id, () =>
                        set(choosePrimaryRune(page, row, id)),
                      ),
                    )}
                  </div>
                  {detail(ids[row])}
                </div>
              ))}
            </div>
          ) : (
            <p className="rune-hint">Choose a primary path.</p>
          )}
        </section>

        <section className="rune-tree secondary" aria-label="Secondary path">
          {treePicker(
            secondary,
            data.trees.filter((t) => t.id !== page.primaryStyleId),
            (t) => set(chooseSecondary(page, t.id)),
            'Secondary path',
            !primary,
          )}
          {secondary ? (
            <div className="rune-rows">
              {secondary.slots.slice(1).map((slot, i) => {
                const chosen = slot.perks.find((id) => ids[4] === id || ids[5] === id)
                return (
                  <div
                    key={i}
                    className="rune-row"
                    role="group"
                    aria-label={slot.label || `Row ${i + 1}`}
                  >
                    <span className={`rune-node ${chosen ? 'filled' : ''}`} aria-hidden />
                    <div className="rune-options">
                      {slot.perks.map((id) =>
                        option(id, 'rune', chosen === id, () =>
                          set(chooseSecondaryRune(page, secondary, id)),
                        ),
                      )}
                    </div>
                    {chosen ? detail(chosen) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="rune-hint">
              {primary ? 'Choose a secondary path: two runes from different rows.' : ''}
            </p>
          )}
          <div className="rune-rows shards">
            {data.shards.map((slot, row) => (
              <div key={row} className="rune-row" role="group" aria-label={`${slot.label} shard`}>
                <span className={`rune-node ${ids[6 + row] ? 'filled' : ''}`} aria-hidden />
                <div className="rune-options">
                  {slot.perks.map((id) =>
                    option(id, 'shard', ids[6 + row] === id, () => set(chooseShard(page, row, id))),
                  )}
                </div>
                {detail(ids[6 + row])}
              </div>
            ))}
          </div>
        </section>

        <div className="rune-caption" aria-live="polite">
          {primary && perk(ids[0]) ? (
            <>
              <strong>{perk(ids[0])!.name}</strong>
              <span>
                {primary.name}
                {secondary ? ` · ${secondary.name}` : ''}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <label className="rune-detail-toggle">
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
        Show detailed descriptions (or hold Shift)
      </label>

      {tip && (
        <div
          className="rune-tooltip"
          id={tipId}
          role="tooltip"
          style={
            { left: tip.left, top: tip.top, '--tree': primary?.color ?? '#c8aa6e' } as CSSProperties
          }
        >
          <div className="rune-tooltip-head">
            <img src={tip.icon} alt="" />
            <strong>{tip.title}</strong>
          </div>
          <div className="rune-tooltip-body">
            <RuneText markup={showDetail ? tip.detail : tip.body} />
          </div>
          {!showDetail && tip.detail !== tip.body && (
            <small className="rune-tooltip-hint">Hold Shift for details</small>
          )}
        </div>
      )}
    </div>
  )
}
