import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fmtAmount } from '../lib/units'
import { stepsOf } from '../lib/score'
import { energyReadout, applyFuel, KCAL_PER_KG } from '../lib/coach'
import type { Profile } from '../types'
import { workoutType, workoutTitle, workoutDetails, setsSummary } from '../lib/workouts'
import { fetchDays, totalsOf, goalFor } from '../hooks/useData'
import { todayKey, addDays, startOfWeek, weekKeys, monthKeys, fromKey, fmtDay, fmtMonth } from '../lib/dates'
import { rangeReport } from '../lib/llm'
import { CopyButton, Panel, ChevronLeft, ChevronRight } from './ui'
import type { DayDoc, Settings } from '../types'

type Mode = 'week' | 'month'

export default function Reports({ uid, settings }: { uid: string; settings: Settings }) {
  const [mode, setMode] = useState<Mode>('week')
  const MODES: [Mode, string][] = [['week', 'Weekly'], ['month', 'Monthly']]

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full border border-edge bg-panel p-1">
        {MODES.map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${
              mode === m ? 'bg-grind text-ink' : 'text-mist hover:text-bone'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'week' ? <RangeView uid={uid} settings={settings} mode="week" /> : <RangeView uid={uid} settings={settings} mode="month" />}
    </div>
  )
}

function RangeView({ uid, settings, mode }: { uid: string; settings: Settings; mode: Mode }) {
  const [anchor, setAnchor] = useState(todayKey())
  const [days, setDays] = useState<Record<string, DayDoc> | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const { keys, title } = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(anchor)
      return { keys: weekKeys(start), title: `Week of ${fmtDay(start)}` }
    }
    const d = fromKey(anchor)
    return {
      keys: monthKeys(d.getFullYear(), d.getMonth()),
      title: fmtMonth(d.getFullYear(), d.getMonth()),
    }
  }, [anchor, mode])

  useEffect(() => {
    let live = true
    setDays(null)
    fetchDays(uid, keys[0], keys[keys.length - 1]).then((d) => { if (live) setDays(d) })
    return () => { live = false }
  }, [uid, keys])

  const shift = (dir: number) => {
    if (mode === 'week') return setAnchor(addDays(startOfWeek(anchor), dir * 7))
    const d = fromKey(anchor)
    d.setDate(1)
    d.setMonth(d.getMonth() + dir)
    setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }

  const logged = days ? keys.filter((k) => days[k]?.entries?.length) : []
  const avg = logged.length && days
    ? logged.reduce(
        (a, k) => {
          const t = totalsOf(days[k])
          return {
            kcal: a.kcal + t.kcal / logged.length,
            protein: a.protein + t.protein / logged.length,
            carbs: a.carbs + t.carbs / logged.length,
            fat: a.fat + t.fat / logged.length,
          }
        },
        { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      )
    : null

  const hitsOf = (k: string): { protein: boolean; kcal: boolean } | null => {
    const day = days?.[k]
    if (!day?.entries?.length) return null
    const { goal: g } = applyFuel(goalFor(settings, day), day, settings.profile)
    const t = totalsOf(day)
    return {
      protein: t.protein >= g.protein * 0.95,
      kcal: t.kcal >= g.kcal * 0.9 && t.kcal <= g.kcal * 1.1,
    }
  }

  // an unfinished day can still be fixed — it only counts against you once
  // it's over (hits already earned today DO count for you)
  const complianceDen = logged.filter((k) => k < todayKey()).length * 2
    + (logged.includes(todayKey())
      ? Number(hitsOf(todayKey())?.protein ?? 0) + Number(hitsOf(todayKey())?.kcal ?? 0)
      : 0)
  const complianceNum = logged
    .map(hitsOf)
    .reduce((n, h) => n + (h ? Number(h.protein) + Number(h.kcal) : 0), 0)
  const compliance = complianceDen ? Math.round((complianceNum / complianceDen) * 100) : null

  const maxKcal = days
    ? Math.max(settings.rest.kcal, settings.training.kcal, ...keys.map((k) => totalsOf(days[k]).kcal))
    : 1

  const HITS: [('protein' | 'kcal'), string][] = [['protein', 'Protein'], ['kcal', 'Calories']]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="rounded-full p-1.5 text-mist hover:bg-raise hover:text-bone">
            <ChevronLeft className="size-5" />
          </button>
          <span className="min-w-36 text-center font-semibold">{title}</span>
          <button onClick={() => shift(1)} className="rounded-full p-1.5 text-mist hover:bg-raise hover:text-bone">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <CopyButton text={() => rangeReport(`${mode === 'week' ? 'Weekly' : 'Monthly'} report — ${title}`, keys, days ?? {}, settings)} />
      </div>

      {!days ? (
        <div className="py-20 text-center text-mist">Loading…</div>
      ) : (
        <>
          {/* summary stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Avg kcal" value={avg ? Math.round(avg.kcal) : '—'} />
            <Stat label="Avg protein" value={avg ? `${Math.round(avg.protein)}g` : '—'} />
            <Stat label="Days logged" value={`${logged.length}/${keys.length}`} />
            <Stat
              label="Trained"
              value={keys.filter((k) => days[k]?.workouts?.length).length}
              sub="workouts logged"
            />
            <Stat
              label="Avg sleep"
              value={(() => {
                const slept = keys.filter((k) => days[k]?.sleep)
                if (!slept.length) return '—'
                return `${Math.round((slept.reduce((s, k) => s + (days[k].sleep ?? 0), 0) / slept.length) * 10) / 10}h`
              })()}
            />
            <Stat
              label="Avg steps"
              value={(() => {
                const days_ = keys.filter((k) => stepsOf(days[k]))
                if (!days_.length) return '—'
                return Math.round(days_.reduce((s, k) => s + stepsOf(days[k]), 0) / days_.length).toLocaleString()
              })()}
            />
            <Stat
              label="Avg resting HR"
              value={(() => {
                const days_ = keys.filter((k) => days[k]?.garmin?.restingHr)
                if (!days_.length) return '—'
                return `${Math.round(days_.reduce((s, k) => s + (days[k].garmin?.restingHr ?? 0), 0) / days_.length)} bpm`
              })()}
            />
            <Stat label="Compliance" value={compliance === null ? '—' : `${compliance}%`} sub="protein + kcal hits" />
          </div>

          {/* compliance + calories side by side on desktop */}
          <div className={mode === 'week' ? 'grid gap-4 lg:grid-cols-2' : ''}>
          {mode === 'week' && (
            <Panel className="p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-mist">Compliance</div>
              <div className="flex items-center gap-2 py-1">
                <span className="w-16 text-xs text-mist">Training</span>
                <div className="flex flex-1 gap-1">
                  {keys.map((k) => {
                    const trained = (days[k]?.workouts?.length ?? 0) > 0
                    const future = k > todayKey()
                    return (
                      <div
                        key={k}
                        title={fmtDay(k)}
                        className={`flex h-7 flex-1 items-center justify-center rounded text-xs font-bold ${
                          !future && trained ? 'bg-grind-soft text-grind' : 'bg-raise text-mist/40'
                        }`}
                      >
                        {future ? '' : trained ? '✓' : '·'}
                      </div>
                    )
                  })}
                </div>
              </div>
              {HITS.map(([hk, label]) => (
                <div key={hk} className="flex items-center gap-2 py-1">
                  <span className="w-16 text-xs text-mist">{label}</span>
                  <div className="flex flex-1 gap-1">
                    {keys.map((k) => {
                      const h = hitsOf(k)
                      const future = k > todayKey()
                      // today's missed targets are still in play — pending, not failed
                      const pending = k === todayKey() && h != null && !h[hk]
                      return (
                        <div
                          key={k}
                          title={pending ? `${fmtDay(k)} — still in play` : fmtDay(k)}
                          className={`flex h-7 flex-1 items-center justify-center rounded text-xs font-bold ${
                            future || !h || pending
                              ? 'bg-raise text-mist/40'
                              : h[hk]
                                ? 'bg-grind-soft text-grind'
                                : 'bg-over/15 text-over'
                          }`}
                        >
                          {future ? '' : !h ? '·' : pending ? '…' : h[hk] ? '✓' : '✕'}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {/* kcal bars */}
          <Panel className="p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-mist">Calories vs goal</div>
            <div className="flex items-end gap-1" style={{ height: 140 }}>
              {keys.map((k) => {
                const day = days[k]
                const t = totalsOf(day)
                const { goal: g } = applyFuel(goalFor(settings, day), day, settings.profile)
                const h = t.kcal > 0 ? Math.max((t.kcal / maxKcal) * 100, 3) : 0
                // same semantics as the diary: green inside the ±10% band,
                // amber outside it, red ONLY on a true surplus (above burn)
                const ratio = g.kcal > 0 ? t.kcal / g.kcal : 0
                const r = settings.profile ? energyReadout(settings.profile, day, t.kcal) : null
                const surplus = t.kcal > 0 && (r ? t.kcal > r.maintenance : ratio > 1.1)
                const future = k > todayKey()
                // settled verdicts only: in-band green and surplus red hold for
                // today, but an under-band today is merely unfinished
                const inPlay = k === todayKey() && !surplus && ratio < 0.9
                return (
                  <div key={k} className="group relative flex flex-1 flex-col justify-end self-stretch">
                    <div
                      className="rounded-t-sm transition-all"
                      style={{
                        height: `${h}%`,
                        background: surplus ? 'var(--color-over)'
                          : ratio >= 0.9 && ratio <= 1.1 ? 'var(--color-grind)'
                          : inPlay ? 'var(--color-mist)'
                          : 'var(--color-carbs)',
                        opacity: future ? 0.15 : inPlay ? 0.45 : 1,
                      }}
                    />
                    {t.kcal === 0 && <div className="h-px bg-edge" />}
                    <div className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-raise px-2 py-0.5 text-[10px] text-bone opacity-0 transition group-hover:opacity-100">
                      {fmtDay(k)}: {Math.round(t.kcal)}
                    </div>
                  </div>
                )
              })}
            </div>
            {mode === 'week' && (
              <div className="mt-2 flex gap-1">
                {keys.map((k) => (
                  <div key={k} className="flex-1 text-center text-[10px] text-mist">{fmtDay(k).slice(0, 3)}</div>
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-4 text-[10px] text-mist">
              <Legend color="var(--color-grind)" label="on target" />
              <Legend color="var(--color-carbs)" label="off target" />
              <Legend color="var(--color-over)" label="surplus (above burn)" />
              <Legend color="var(--color-mist)" label="today, in play" />
            </div>
          </Panel>
          </div>

          {/* energy balance — the honest ledger */}
          {settings.profile && (
            <EnergyBalance profile={settings.profile} keys={keys} days={days} />
          )}

          {/* body trend + food-math calibration */}
          <BodyTrend keys={keys} days={days} settings={settings} />

          {/* per-day table */}
          <Panel className="divide-y divide-edge">
            {keys.filter((k) => k <= todayKey()).map((k) => {
              const day = days[k]
              const t = totalsOf(day)
              const empty = !day?.entries?.length && !day?.workouts?.length
              const isOpen = open[k]
              return (
                <div key={k}>
                  <button
                    onClick={() => !empty && setOpen({ ...open, [k]: !isOpen })}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${empty ? 'cursor-default text-mist/50' : ''}`}
                  >
                    <span className="w-20 font-medium">
                      {fmtDay(k)}
                      {(day?.workouts?.length ?? 0) > 0 && <span className="ml-1.5 text-[10px]">🏋️</span>}
                      {settings.trainingEnabled && day?.training && <span className="ml-1.5 text-[10px] text-grind">T</span>}
                    </span>
                    {empty ? (
                      <span className="text-xs">not logged</span>
                    ) : !day?.entries?.length ? (
                      <span className="flex items-center gap-2 text-xs text-mist">
                        trained, no food logged
                        <span className={`text-[10px] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 tabular-nums text-mist">
                        <span>
                          <b className="text-bone">{Math.round(t.kcal)}</b> kcal · P {Math.round(t.protein)} · C {Math.round(t.carbs)} · F {Math.round(t.fat)}
                        </span>
                        <span className={`text-[10px] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                      </span>
                    )}
                  </button>
                  {isOpen && !empty && (
                    <div className="space-y-1 bg-ink/40 px-4 pb-3 pt-1">
                      {(day.sleep || stepsOf(day) || day.garmin?.restingHr) && (
                        <div className="flex items-center gap-3 text-xs text-mist">
                          {day.sleep ? <span>😴 {day.sleep}h</span> : null}
                          {stepsOf(day) ? <span>👟 {stepsOf(day).toLocaleString()}</span> : null}
                          {day.garmin?.restingHr ? <span>❤️ {day.garmin.restingHr} bpm</span> : null}
                        </div>
                      )}
                      {(day.workouts ?? []).map((w) => (
                        <div key={w.id}>
                          <div className="flex items-center justify-between text-xs text-grind">
                            <span>{workoutType(w.type).icon} {workoutTitle(w)}</span>
                            <span className="tabular-nums text-mist">{workoutDetails(w)}</span>
                          </div>
                          {w.sets?.length ? <div className="text-[11px] text-mist">{setsSummary(w)}</div> : null}
                        </div>
                      ))}
                      {day.entries.map((e) => (
                        <div key={e.id} className="flex items-center justify-between text-xs text-mist">
                          <span className={e.alcohol ? 'text-over' : ''}>
                            {e.alcohol ? '🍺 ' : ''}{e.name} {fmtAmount(e) && <span className={e.alcohol ? 'text-over/60' : 'text-mist/60'}>{fmtAmount(e)}</span>}
                          </span>
                          <span className="tabular-nums">
                            {Math.round(e.kcal)} kcal · P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </Panel>
        </>
      )}
    </div>
  )
}

// Per-day energy balance: eaten − (rest burn + that day's logged exercise).
// Only days with logged food count — an empty diary is missing data, not a
// deficit. Everything is an estimate and says so.
function EnergyBalance({ profile, keys, days }: {
  profile: Profile
  keys: string[]
  days: Record<string, DayDoc>
}) {
  const rows = keys
    .filter((k) => k <= todayKey())
    .map((k) => {
      const day = days[k]
      const logged = Boolean(day?.entries?.length)
      const r = day ? energyReadout(profile, day, totalsOf(day).kcal) : null
      return { k, logged, r }
    })

  const counted = rows.filter((x) => x.logged && x.r)
  if (!counted.length) return null

  const totalDelta = counted.reduce((s, x) => s + (x.r?.delta ?? 0), 0)
  const estKg = Math.round((totalDelta / KCAL_PER_KG) * 100) / 100
  const maxAbs = Math.max(400, ...counted.map((x) => Math.abs(x.r?.delta ?? 0)))

  return (
    <Panel className="p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-mist">Energy balance</span>
        <span className="text-[10px] text-mist">eaten vs burn (incl. exercise) · logged days only · estimates</span>
      </div>
      <div className="flex items-center gap-1" style={{ height: 110 }}>
        {rows.map(({ k, logged, r }) => {
          if (!logged || !r) {
            return (
              <div key={k} className="flex flex-1 flex-col justify-center self-stretch" title={`${fmtDay(k)}: not logged`}>
                <div className="h-px bg-edge" />
              </div>
            )
          }
          const h = Math.min(50, (Math.abs(r.delta) / maxAbs) * 50)
          const up = r.delta > 0
          // one rule, same as the diary: red = surplus, green = deficit
          // (that's the plan working), amber = hovering at maintenance or an
          // extreme >1000 under-fuel that deserves attention, not applause
          const color =
            r.delta > 150 ? 'var(--color-over)'
            : r.delta > -100 ? 'var(--color-carbs)'
            : r.delta <= -1000 ? 'var(--color-carbs)'
            : 'var(--color-grind)'
          return (
            <div key={k} className="group relative flex flex-1 flex-col self-stretch" title={`${fmtDay(k)}: ${r.delta > 0 ? '+' : ''}${r.delta} kcal (${r.zone.label})`}>
              <div className="flex flex-1 flex-col justify-end">
                {up && <div className="rounded-t-sm" style={{ height: `${h}%`, background: color }} />}
              </div>
              <div className="h-px bg-mist/40" />
              <div className="flex flex-1 flex-col justify-start">
                {!up && <div className="rounded-b-sm" style={{ height: `${h}%`, background: color }} />}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 text-xs text-mist">
        Over <b className="text-bone">{counted.length}</b> logged day{counted.length > 1 ? 's' : ''}:{' '}
        <b className="text-bone">{totalDelta > 0 ? '+' : ''}{totalDelta.toLocaleString()}</b> kcal
        {' '}→ implied weight change ≈ <b style={{ color: estKg <= 0 ? 'var(--color-grind)' : 'var(--color-fat)' }}>{estKg > 0 ? '+' : ''}{estKg} kg</b>
        {rows.some((x) => !x.logged) && <span className="text-mist/60"> · unlogged days excluded, not assumed</span>}
      </div>
    </Panel>
  )
}

// Weight trend (raw weigh-ins + 7-day rolling average) and, when possible,
// the calibration check: does the scale agree with the food math?
function BodyTrend({ keys, days, settings }: {
  keys: string[]
  days: Record<string, DayDoc>
  settings: Settings
}) {
  const points = keys
    .filter((k) => k <= todayKey() && days[k]?.body?.weightKg)
    .map((k) => ({ k, w: days[k].body!.weightKg, bf: days[k].body!.bodyFatPct ?? null, mus: days[k].body!.muscleKg ?? null }))
  if (points.length < 1) return null

  // rolling 7-day average per weigh-in (by calendar distance)
  const dayNum = (k: string) => Math.floor(fromKey(k).getTime() / 86400000)
  const rolled = points.map((pt) => {
    const n0 = dayNum(pt.k)
    const win = points.filter((q) => n0 - dayNum(q.k) >= 0 && n0 - dayNum(q.k) < 7)
    return { ...pt, avg: win.reduce((s, q) => s + q.w, 0) / win.length }
  })

  const first = rolled[0]
  const last = rolled[rolled.length - 1]
  const spanDays = Math.max(1, dayNum(last.k) - dayNum(first.k))
  const deltaKg = Math.round((last.avg - first.avg) * 100) / 100
  const perWeek = Math.round(((deltaKg / spanDays) * 7) * 100) / 100

  // svg polyline
  const ws = rolled.map((r) => r.w)
  const min = Math.min(...ws) - 0.4
  const max = Math.max(...ws) + 0.4
  const x = (i: number) => (rolled.length === 1 ? 50 : (i / (rolled.length - 1)) * 100)
  const y = (w: number) => 38 - ((w - min) / (max - min)) * 34
  const rawPath = rolled.map((r, i) => `${x(i)},${y(r.w)}`).join(' ')
  const avgPath = rolled.map((r, i) => `${x(i)},${y(r.avg)}`).join(' ')

  // calibration: scale trend vs food-math over the same span
  let calibration: string | null = null
  if (settings.profile && points.length >= 3 && spanDays >= 14) {
    const loggedKeys = keys.filter((k) => k >= first.k && k <= last.k && days[k]?.entries?.length)
    if (loggedKeys.length >= spanDays * 0.6) {
      const implied = loggedKeys.reduce((s, k) => s + energyReadout(settings.profile!, days[k], totalsOf(days[k]).kcal).delta, 0) / KCAL_PER_KG
      const diffKcalPerDay = Math.round(((implied - deltaKg) * KCAL_PER_KG) / spanDays)
      if (Math.abs(diffKcalPerDay) > 120) {
        calibration = `Scale says ${deltaKg > 0 ? '+' : ''}${deltaKg} kg; food-math implied ${implied > 0 ? '+' : ''}${Math.round(implied * 100) / 100} kg → your real maintenance is ≈ ${diffKcalPerDay > 0 ? '' : '+'}${-diffKcalPerDay} kcal/day ${diffKcalPerDay > 0 ? 'lower' : 'higher'} than estimated. Consider retuning in Settings.`
      } else {
        calibration = 'Scale and food-math agree within noise — your maintenance estimate is well calibrated.'
      }
    }
  }

  return (
    <Panel className="p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-mist">Body</span>
        <span className="text-[10px] text-mist">dots = weigh-ins · line = 7-day average (the trend that matters)</span>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full">
        <polyline points={rawPath} fill="none" stroke="var(--color-edge)" strokeWidth="0.6" />
        {rolled.map((r, i) => (
          <circle key={r.k} cx={x(i)} cy={y(r.w)} r="1.1" fill="var(--color-mist)" />
        ))}
        <polyline points={avgPath} fill="none" stroke="var(--color-grind)" strokeWidth="1" />
      </svg>
      <div className="mt-1 text-xs text-mist">
        <b className="text-bone">{last.w} kg</b> latest
        {points.length > 1 && (
          <> · trend <b style={{ color: deltaKg <= 0 ? 'var(--color-grind)' : 'var(--color-fat)' }}>{deltaKg > 0 ? '+' : ''}{deltaKg} kg</b> over {spanDays}d ({perWeek > 0 ? '+' : ''}{perWeek} kg/week)</>
        )}
        {last.bf ? <> · {last.bf}% bf</> : null}
        {last.mus ? <> · {last.mus} kg muscle</> : null}
      </div>
      {calibration && <p className="mt-1.5 text-[11px] text-carbs">{calibration}</p>}
    </Panel>
  )
}

const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <Panel className="p-4">
    <div className="text-xs font-medium uppercase tracking-wider text-mist">{label}</div>
    <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    {sub && <div className="text-[10px] text-mist">{sub}</div>}
  </Panel>
)

const Legend = ({ color, label }: { color: string; label: string }) => (
  <span className="flex items-center gap-1.5">
    <span className="size-2 rounded-full" style={{ background: color }} /> {label}
  </span>
)
