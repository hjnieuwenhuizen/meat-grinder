import { useEffect, useMemo, useState } from 'react'
import { fmtAmount } from '../lib/units'
import { workoutType, workoutTitle, workoutDetails } from '../lib/workouts'
import { fetchDays, totalsOf, goalFor } from '../hooks/useData'
import { todayKey, addDays, startOfWeek, weekKeys, monthKeys, fromKey, fmtDay, fmtMonth } from '../lib/dates'
import { rangeReport } from '../lib/llm'
import { CopyButton, Panel, ChevronLeft, ChevronRight } from './ui'

export default function Reports({ uid, settings }) {
  const [mode, setMode] = useState('week')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full border border-edge bg-panel p-1">
        {[['week', 'Weekly'], ['month', 'Monthly']].map(([m, label]) => (
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

function RangeView({ uid, settings, mode }) {
  const [anchor, setAnchor] = useState(todayKey())
  const [days, setDays] = useState(null)
  const [open, setOpen] = useState({})

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

  const shift = (dir) => {
    if (mode === 'week') return setAnchor(addDays(startOfWeek(anchor), dir * 7))
    const d = fromKey(anchor)
    d.setDate(1)
    d.setMonth(d.getMonth() + dir)
    setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }

  const logged = days ? keys.filter((k) => days[k]?.entries?.length) : []
  const avg = logged.length
    ? logged.reduce((a, k) => {
        const t = totalsOf(days[k])
        return { kcal: a.kcal + t.kcal / logged.length, protein: a.protein + t.protein / logged.length, carbs: a.carbs + t.carbs / logged.length, fat: a.fat + t.fat / logged.length }
      }, { kcal: 0, protein: 0, carbs: 0, fat: 0 })
    : null

  const hitsOf = (k) => {
    const day = days?.[k]
    if (!day?.entries?.length) return null
    const g = goalFor(settings, day)
    const t = totalsOf(day)
    return {
      protein: t.protein >= g.protein * 0.95,
      kcal: t.kcal >= g.kcal * 0.9 && t.kcal <= g.kcal * 1.1,
    }
  }

  const allHits = logged.map(hitsOf)
  const compliance = logged.length
    ? Math.round((allHits.reduce((n, h) => n + h.protein + h.kcal, 0) / (logged.length * 2)) * 100)
    : null

  const maxKcal = days
    ? Math.max(settings.rest.kcal, settings.training.kcal, ...keys.map((k) => totalsOf(days[k]).kcal))
    : 1

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                return `${Math.round((slept.reduce((s, k) => s + days[k].sleep, 0) / slept.length) * 10) / 10}h`
              })()}
            />
            <Stat label="Compliance" value={compliance === null ? '—' : `${compliance}%`} sub="protein + kcal hits" />
          </div>

          {/* compliance grid (week only) */}
          {mode === 'week' && (
            <Panel className="p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-mist">Compliance</div>
              <div className="flex items-center gap-2 py-1">
                <span className="w-16 text-xs text-mist">Training</span>
                <div className="flex flex-1 gap-1">
                  {keys.map((k) => {
                    const trained = days[k]?.workouts?.length > 0
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
              {[['protein', 'Protein'], ['kcal', 'Calories']].map(([hk, label]) => (
                <div key={hk} className="flex items-center gap-2 py-1">
                  <span className="w-16 text-xs text-mist">{label}</span>
                  <div className="flex flex-1 gap-1">
                    {keys.map((k) => {
                      const h = hitsOf(k)
                      const future = k > todayKey()
                      return (
                        <div
                          key={k}
                          title={fmtDay(k)}
                          className={`flex h-7 flex-1 items-center justify-center rounded text-xs font-bold ${
                            future || !h
                              ? 'bg-raise text-mist/40'
                              : h[hk]
                                ? 'bg-grind-soft text-grind'
                                : 'bg-over/15 text-over'
                          }`}
                        >
                          {future ? '' : !h ? '·' : h[hk] ? '✓' : '✕'}
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
                const g = goalFor(settings, day)
                const h = t.kcal > 0 ? Math.max((t.kcal / maxKcal) * 100, 3) : 0
                const off = t.kcal > 0 && (t.kcal < g.kcal * 0.9 || t.kcal > g.kcal * 1.1)
                const future = k > todayKey()
                return (
                  <div key={k} className="group relative flex flex-1 flex-col justify-end self-stretch">
                    <div
                      className="rounded-t-sm transition-all"
                      style={{
                        height: `${h}%`,
                        background: t.kcal > g.kcal ? 'var(--color-over)' : off ? 'var(--color-carbs)' : 'var(--color-grind)',
                        opacity: future ? 0.15 : 1,
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
              <Legend color="var(--color-carbs)" label="under" />
              <Legend color="var(--color-over)" label="over" />
            </div>
          </Panel>

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
                      {day?.workouts?.length > 0 && <span className="ml-1.5 text-[10px]">🏋️</span>}
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
                      {(day.workouts ?? []).map((w) => (
                        <div key={w.id} className="flex items-center justify-between text-xs text-grind">
                          <span>{workoutType(w.type).icon} {workoutTitle(w)}</span>
                          <span className="tabular-nums text-mist">{workoutDetails(w)}</span>
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

const Stat = ({ label, value, sub }) => (
  <Panel className="p-4">
    <div className="text-xs font-medium uppercase tracking-wider text-mist">{label}</div>
    <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    {sub && <div className="text-[10px] text-mist">{sub}</div>}
  </Panel>
)

const Legend = ({ color, label }) => (
  <span className="flex items-center gap-1.5">
    <span className="size-2 rounded-full" style={{ background: color }} /> {label}
  </span>
)
