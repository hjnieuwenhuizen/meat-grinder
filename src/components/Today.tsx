import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useDay, totalsOf, goalFor, type FoodsApi } from '../hooks/useData'
import { publishScore, type PublishTargets } from '../hooks/useFamily'
import { scoreDay, stepsOf } from '../lib/score'
import { todayKey, addDays, fmtLong } from '../lib/dates'
import { isPer100, unitOf, amountOf, fmtAmount, basisLabel, scaleFor } from '../lib/units'
import { MEALS, defaultMealNow } from '../lib/meals'
import { WORKOUT_TYPES, DISTANCE_TYPES, workoutType, workoutTitle, workoutDetails } from '../lib/workouts'
import { dayReport } from '../lib/llm'
import { useSyncing } from '../hooks/useSync'
import { energyReadout, heroBands, applyFuel, kgPerWeek } from '../lib/coach'
import type { BodyLog, DayDoc, Profile } from '../types'
import { CopyButton, Modal, Field, Ring, Panel, Plus, Trash, ChevronLeft, ChevronRight } from './ui'
import type { Entry, Food, Macros, MealId, Settings, Workout, WorkoutTypeId } from '../types'

const MACROS = ['protein', 'carbs', 'fat'] as const

interface TodayProps {
  uid: string
  settings: Settings
  foods: Food[]
  addFood: FoodsApi['addFood']
  updateFood: FoodsApi['updateFood']
  publish: PublishTargets
  saveSettings: (s: Settings) => void | Promise<void>
}

type Drag = { id: string; kind: 'entry' | 'workout' } | null

export default function Today({ uid, settings, foods, addFood, updateFood, publish, saveSettings }: TodayProps) {
  const [key, setKey] = useState(todayKey())
  const { day, addEntry, removeEntry, updateEntry, setTraining, setSleep, setSteps, addWorkout, updateWorkout, removeWorkout, setBody } = useDay(uid, key, settings)
  const [adding, setAdding] = useState(false)
  const [rescuing, setRescuing] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [editingWorkout, setEditingWorkout] = useState<Workout | 'new' | null>(null)
  const [bodyOpen, setBodyOpen] = useState(false)
  const [drag, setDrag] = useState<Drag>(null)
  const [dragOver, setDragOver] = useState<MealId | null>(null)

  const bumpUsed = (food: Food) =>
    updateFood(food.id, { used: (food.used || 0) + 1, lastUsed: Date.now() })

  const syncing = useSyncing()

  // keep the leaderboards in sync with whatever day is on screen
  useEffect(() => {
    if ((!publish.code && !publish.global) || !day) return
    const t = setTimeout(() => {
      void publishScore(publish, uid, key, scoreDay(day, settings)).catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [publish, uid, key, day, settings])

  if (!day) return <div className="py-20 text-center text-mist">Loading…</div>

  // endurance fueling: big logged burns raise today's goal (partial, as carbs)
  const { goal, fuel } = applyFuel(goalFor(settings, day), day, settings.profile)
  const totals = totalsOf(day)
  const left = Math.round(goal.kcal - totals.kcal)
  const kcalPct = Math.min(totals.kcal / goal.kcal, 1)
  // acceptable range: 90–110% of goal
  const ratio = goal.kcal > 0 ? totals.kcal / goal.kcal : 0
  const kcalStatus = ratio > 1.1 ? 'over' : ratio >= 0.9 ? 'good' : 'low'
  const kcalColor =
    kcalStatus === 'over' ? 'var(--color-over)'
    : kcalStatus === 'good' ? 'var(--color-grind)'
    : 'var(--color-carbs)'

  return (
    <div className="space-y-4">
      {/* date nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => setKey(addDays(key, -1))} className="rounded-full p-1.5 text-mist hover:bg-raise hover:text-bone">
            <ChevronLeft className="size-5" />
          </button>
          <button
            onClick={() => setKey(todayKey())}
            className="min-w-44 text-center font-semibold"
            title="Jump to today"
          >
            {key === todayKey() ? 'Today' : fmtLong(key)}
          </button>
          <button onClick={() => setKey(addDays(key, 1))} className="rounded-full p-1.5 text-mist hover:bg-raise hover:text-bone">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          {syncing && (
            <span className="flex items-center gap-1.5 text-xs text-mist" title="Pulling latest from Garmin / Health Connect">
              <span className="size-3 animate-spin rounded-full border-2 border-edge border-t-grind" />
              syncing
            </span>
          )}
          <CopyButton text={() => dayReport(key, day, settings)} />
        </div>
      </div>

      <div className="space-y-4 lg:grid lg:grid-cols-5 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="space-y-4 lg:col-span-2">
      {/* training toggle + sleep */}
      <div className="flex flex-wrap items-center gap-2">
        {settings.trainingEnabled && (
          <button
            onClick={() => setTraining(!day.training)}
            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              day.training
                ? 'border-grind/60 bg-grind-soft text-grind'
                : 'border-edge bg-panel text-mist hover:text-bone'
            }`}
          >
            <span className={`size-2 rounded-full ${day.training ? 'bg-grind' : 'bg-edge'}`} />
            Training day
          </button>
        )}
        <label className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-4 py-1.5 text-sm">
          <span>😴</span>
          <input
            key={key}
            type="number" inputMode="decimal" step="0.5" min="0" max="16"
            defaultValue={day.sleep ?? ''}
            onBlur={(e) => {
              const v = Number(e.target.value) || null
              if (v !== (day.sleep ?? null)) setSleep(v)
            }}
            placeholder="–"
            className="w-10 bg-transparent text-center font-medium text-bone outline-none"
          />
          <span className="text-xs text-mist">h sleep</span>
        </label>
        <label className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-4 py-1.5 text-sm" title={day.garmin?.steps ? 'Steps (Garmin — type to override)' : 'Steps (manual)'}>
          <span>👟</span>
          <input
            key={key}
            type="number" inputMode="numeric" step="100" min="0" max="200000"
            defaultValue={stepsOf(day) || ''}
            onBlur={(e) => {
              const v = Math.round(Number(e.target.value)) || null
              if (v !== (stepsOf(day) || null)) setSteps(v)
            }}
            placeholder="–"
            className="w-16 bg-transparent text-center font-medium text-bone outline-none"
          />
          <span className="text-xs text-mist">steps</span>
        </label>
        {day.garmin?.restingHr ? (
          <span className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-4 py-1.5 text-sm text-mist" title="Resting heart rate (Garmin)">
            ❤️ <b className="font-medium text-bone">{day.garmin.restingHr}</b> bpm rest
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setBodyOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-4 py-1.5 text-sm text-mist transition hover:border-grind/40 hover:text-bone"
          title="Log weight / body composition"
        >
          ⚖️ {day.body?.weightKg ? <b className="font-medium text-bone">{day.body.weightKg} kg</b> : <span>weigh-in</span>}
          {day.body?.bodyFatPct ? <span className="text-xs">· {day.body.bodyFatPct}% bf</span> : null}
        </button>
      </div>

      {/* calories hero */}
      <Panel className="p-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-mist">Calories</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-5xl font-bold tabular-nums ${kcalStatus === 'over' ? 'text-over' : ''}`}>
                {Math.round(totals.kcal)}
              </span>
              <span className="text-mist">/ {Math.round(goal.kcal)}</span>
            </div>
            {fuel > 0 && (
              <div className="mt-0.5 text-[11px] text-grind" title="60% of estimated exercise burn above 400 kcal, added as carbs — runs estimated from distance × body weight; watch calories overestimate">
                incl. +{fuel} endurance fuel 🏃
              </div>
            )}
          </div>
          <div className="text-right text-sm font-medium" style={{ color: kcalColor }}>
            {left < 0 ? `${-left} over` : `${left} left`}
            {kcalStatus === 'good' && <span className="ml-1.5 text-xs opacity-80">in range</span>}
          </div>
        </div>
        {settings.profile ? (
          <ZonedKcalBar profile={settings.profile} day={day} eaten={totals.kcal} goalKcal={goal.kcal} fillColor={kcalColor} complete={key < todayKey()} />
        ) : (
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${kcalPct * 100}%`, background: kcalColor }}
            />
          </div>
        )}
        {(() => {
          const booze = day.entries.filter((e) => e.alcohol)
          if (!booze.length) return null
          const kcal = booze.reduce((s, e) => s + e.kcal, 0)
          const grams = booze.reduce((s, e) => s + (e.alcoholG || 0), 0)
          return (
            <div className="mt-2.5 text-xs font-medium text-over">
              🍺 {Math.round(kcal)} kcal of that is alcohol{grams > 0 ? ` (${Math.round(grams)}g pure alcohol)` : ''}
            </div>
          )
        })()}
      </Panel>

      {/* today's mission */}
      <Mission goal={goal} totals={totals} day={day} foods={foods} onRescue={() => setRescuing(true)} />

      {/* macro rings — protein is a hard target; carbs/fat are flexible energy
          levers judged by the calorie budget, never by their own line */}
      <div className="grid grid-cols-3 gap-3">
        {MACROS.map((macro) => {
          const val = totals[macro]
          const g = goal[macro]
          let color: string
          if (macro === 'protein') {
            const r = g > 0 ? val / g : 0
            color = r >= 1 ? 'var(--color-protein)' : r >= 0.8 ? 'var(--color-carbs)' : 'var(--color-mist)'
          } else {
            const kcalR = goal.kcal > 0 ? totals.kcal / goal.kcal : 0
            if (kcalR > 1.05) color = 'var(--color-over)' // calorie budget blown
            else if (g > 0 && val > g) color = 'var(--color-carbs)' // over its own line, calories fine
            else color = 'var(--color-grind)'
          }
          return (
            <Panel key={macro} className="flex flex-col items-center gap-2 p-4">
              <Ring value={val} goal={g} color={color} okOver>
                <span className="text-lg font-bold tabular-nums">{Math.round(val)}</span>
                <span className="text-[10px] text-mist">/ {Math.round(g)}g</span>
              </Ring>
              <span className="text-xs font-medium uppercase tracking-wider text-mist">{macro}</span>
              {macro !== 'protein' && (
                <span className="-mt-1 text-center text-[9px] leading-tight text-mist/60">flexible — balanced against calories</span>
              )}
            </Panel>
          )
        })}
      </div>
      </div>

      {/* entries */}
      <div className="lg:col-span-3">
      <Panel className="divide-y divide-edge">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-semibold">Today's log</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingWorkout('new')}
              className="flex items-center gap-1.5 rounded-full border border-grind/50 px-4 py-1.5 text-sm font-semibold text-grind transition hover:bg-grind-soft"
            >
              🏋️ Workout
            </button>
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-full bg-grind px-4 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
            >
              <Plus className="size-4" /> Add food
            </button>
          </div>
        </div>
        {day.entries.length === 0 && day.workouts.length === 0 && (
          <p className="p-6 text-center text-sm text-mist">Nothing logged yet. Feed the grinder.</p>
        )}
        {(() => {
          const known = new Set<string>(MEALS.map((m) => m.id))
          const groups: { id: MealId | null; label: string; entries: Entry[]; workouts: Workout[] }[] = [
            ...MEALS.map((m) => ({
              ...m,
              entries: day.entries.filter((e) => e.meal === m.id),
              workouts: day.workouts.filter((w) => w.meal === m.id),
            })),
            {
              id: null, label: 'Unsorted',
              entries: day.entries.filter((e) => !known.has(e.meal ?? '')),
              workouts: day.workouts.filter((w) => !known.has(w.meal ?? '')),
            },
          ].filter((g) => g.entries.length || g.workouts.length || (drag && g.id))

          const workoutRow = (w: Workout) => (
            <div
              key={w.id}
              draggable
              onDragStart={() => setDrag({ id: w.id, kind: 'workout' })}
              onDragEnd={() => { setDrag(null); setDragOver(null) }}
              className={`group mx-4 my-2 flex cursor-grab items-center justify-between rounded-xl border border-grind/30 bg-grind-soft/30 px-3 py-2.5 active:cursor-grabbing ${drag?.id === w.id ? 'opacity-40' : ''}`}
            >
              <button onClick={() => setEditingWorkout(w)} className="flex-1 text-left" title="Edit workout">
                <div className="font-medium text-grind">
                  {workoutType(w.type).icon} {workoutTitle(w)}
                </div>
                {workoutDetails(w) && <div className="mt-0.5 text-xs text-mist">{workoutDetails(w)}</div>}
              </button>
              <button
                onClick={() => removeWorkout(w.id)}
                className="p-1 text-mist opacity-100 transition hover:text-over sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Trash className="size-4" />
              </button>
            </div>
          )

          const entryRow = (e: Entry) => (
            <div
              key={e.id}
              draggable
              onDragStart={() => setDrag({ id: e.id, kind: 'entry' })}
              onDragEnd={() => { setDrag(null); setDragOver(null) }}
              className={`group flex cursor-grab items-center justify-between px-4 py-3 active:cursor-grabbing ${drag?.id === e.id ? 'opacity-40' : ''}`}
            >
              <button onClick={() => setEditing(e)} className="flex-1 text-left" title="Edit entry">
                <div className={`font-medium ${e.alcohol ? 'text-over' : ''}`}>
                  {e.alcohol ? '🍺 ' : ''}{e.name} <span className={`text-sm ${e.alcohol ? 'text-over/60' : 'text-mist'}`}>{fmtAmount(e)}</span>
                </div>
                <div className="mt-0.5 text-xs text-mist">
                  P {Math.round(e.protein)} · C {Math.round(e.carbs)} · F {Math.round(e.fat)}
                </div>
              </button>
              <div className="flex items-center gap-3">
                <span className={`font-semibold tabular-nums ${e.alcohol ? 'text-over' : ''}`}>{Math.round(e.kcal)}</span>
                <button
                  onClick={() => removeEntry(e.id)}
                  className="p-1 text-mist opacity-100 transition hover:text-over sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash className="size-4" />
                </button>
              </div>
            </div>
          )

          return groups.map((g) => (
            <div
              key={g.id ?? 'unsorted'}
              onDragOver={(ev: DragEvent) => { if (drag) { ev.preventDefault(); setDragOver(g.id) } }}
              onDragLeave={() => setDragOver((d) => (d === g.id ? null : d))}
              onDrop={() => {
                if (drag) {
                  if (drag.kind === 'workout') updateWorkout(drag.id, { meal: g.id })
                  else updateEntry(drag.id, { meal: g.id })
                }
                setDrag(null)
                setDragOver(null)
              }}
              className={`transition ${dragOver === g.id && drag ? 'bg-grind-soft/30' : ''}`}
            >
              <div className="flex items-center justify-between px-4 pb-1 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-grind/80">{g.label}</span>
                <span className="text-[10px] tabular-nums text-mist">
                  {g.entries.length
                    ? (() => {
                        const s = totalsOf({ entries: g.entries })
                        return `${Math.round(s.kcal)} kcal · P ${Math.round(s.protein)} · C ${Math.round(s.carbs)} · F ${Math.round(s.fat)}`
                      })()
                    : drag ? 'drop here' : ''}
                </span>
              </div>
              {g.workouts.filter((w) => w.when !== 'after').map(workoutRow)}
              {g.entries.map(entryRow)}
              {g.workouts.filter((w) => w.when === 'after').map(workoutRow)}
            </div>
          ))
        })()}
      </Panel>
      </div>
      </div>

      {adding && (
        <AddFood
          foods={foods}
          addFood={addFood}
          bumpUsed={bumpUsed}
          totals={totals}
          goal={goal}
          onAdd={(entry) => { addEntry(entry) }}
          onClose={() => setAdding(false)}
        />
      )}

      {editingWorkout && (
        <WorkoutModal
          initial={editingWorkout === 'new' ? null : editingWorkout}
          onSave={(w) => {
            if (editingWorkout === 'new') {
              // logging a workout makes it a training day automatically
              addWorkout(w, settings.trainingEnabled && !day.training ? { training: true } : {})
            } else {
              updateWorkout(editingWorkout.id, w)
            }
          }}
          onClose={() => setEditingWorkout(null)}
        />
      )}

      {bodyOpen && (
        <BodyModal
          initial={day.body}
          onSave={(body) => {
            void setBody(body)
            // keep the calculator honest: latest weigh-in updates the profile
            if (body && settings.profile && Math.abs(settings.profile.weightKg - body.weightKg) > 0.05) {
              void saveSettings({ ...settings, profile: { ...settings.profile, weightKg: body.weightKg } })
            }
          }}
          onClose={() => setBodyOpen(false)}
        />
      )}

      {editing && (
        <EditEntry
          entry={editing}
          onSave={(next) => updateEntry(editing.id, next)}
          onClose={() => setEditing(null)}
        />
      )}

      {rescuing && (
        <Rescue
          foods={foods}
          pGap={goal.protein - totals.protein}
          kcalLeft={goal.kcal - totals.kcal}
          onAdd={(entry, food) => { addEntry({ ...entry, meal: defaultMealNow() }); bumpUsed(food) }}
          onClose={() => setRescuing(false)}
        />
      )}
    </div>
  )
}

// The main calorie bar, zoned against today's ACTUAL burn (rest metabolism +
// logged exercise). Bands move right when you train. Everything here is an
// estimate and labelled as such — and the goal budget never eats back burn.
function ZonedKcalBar({ profile, day, eaten, goalKcal, fillColor, complete }: {
  profile: Profile
  day: DayDoc
  eaten: number
  goalKcal: number
  fillColor: string
  /** past days are finished stories; today is still being written */
  complete: boolean
}) {
  const r = energyReadout(profile, day, eaten)
  // the PLAN's position vs today's estimated burn — what the target means
  const plannedDelta = Math.round(goalKcal - r.maintenance)
  const bands = heroBands(r.maintenance)
  const scaleMax = Math.max(goalKcal, r.maintenance + 400)
  const pct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100))

  // band segments as [from, to] clamped to the scale
  const cuts = [0, Math.max(0, r.maintenance - 1000), Math.max(0, r.maintenance - 250), r.maintenance + 150, scaleMax]
  const segs = bands.map((b, i) => ({ ...b, from: cuts[i], to: Math.min(cuts[i + 1], scaleMax) }))
  // the zone the day FINISHED in — only meaningful once the day is complete
  const active = segs.find((s) => eaten >= s.from && eaten < s.to) ?? segs[segs.length - 1]

  return (
    <div className="mt-4">
      <div className="relative h-3 overflow-hidden rounded-full bg-edge">
        {/* zone tint */}
        <div className="absolute inset-0 flex">
          {segs.map((s) => (
            <div key={s.id} style={{ width: `${pct(s.to) - pct(s.from)}%`, background: s.color, opacity: 0.22 }} />
          ))}
        </div>
        {/* eaten fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${pct(eaten)}%`, background: fillColor, opacity: 0.9 }}
        />
        {/* zone boundaries, visible across the fill */}
        {cuts.slice(1, -1).map((c) => (
          <div key={c} className="absolute inset-y-0 w-px bg-ink/70" style={{ left: `${pct(c)}%` }} />
        ))}
        {/* goal tick */}
        <div
          className="absolute inset-y-0 w-0.5 bg-bone"
          style={{ left: `${pct(goalKcal)}%` }}
          title={`Your goal: ${Math.round(goalKcal)} kcal`}
        />
      </div>
      {/* "you are here" caret at the fill's end — mid-day it's just "now", not a verdict */}
      <div className="relative h-3">
        <div
          className="absolute flex -translate-x-1/2 items-center gap-0.5 text-[9px] leading-3 transition-all duration-500"
          style={{ left: `${pct(eaten)}%`, color: complete ? fillColor : 'var(--color-mist)' }}
        >
          ▲{!complete && <span>now</span>}
        </div>
      </div>
      {/* band labels — the finishing zone lights up only once the day is done */}
      <div className="flex text-[9px] leading-tight">
        {segs.map((s) => (
          <div
            key={s.id}
            className={`truncate text-center ${complete && s.id === active.id ? 'font-semibold' : 'text-mist/50'}`}
            style={{ width: `${pct(s.to) - pct(s.from)}%`, ...(complete && s.id === active.id ? { color: s.color } : {}) }}
          >
            {s.label}
          </div>
        ))}
      </div>
      {complete ? (
        <div className="mt-1.5 text-xs text-mist">
          burn ≈ <b className="text-bone">{r.maintenance.toLocaleString()}</b> kcal
          {r.exerciseKcal ? <> (incl. ~{r.exerciseKcal.toLocaleString()} exercise{r.watchKcal > r.exerciseKcal ? ` — watch said ${r.watchKcal.toLocaleString()}` : ''})</> : null}
          {' · '}finished <b className="text-bone">{Math.abs(r.delta).toLocaleString()} {r.delta <= 0 ? 'below' : 'above'}</b> burn
          {' = '}<b style={{ color: r.zone.color }}>{r.zone.label}</b>
          {r.zone.id !== 'maintenance' ? ` ≈ ${r.kgWeek > 0 ? '+' : ''}${r.kgWeek} kg/week` : ''}
          <span className="text-mist/60"> · estimates, not gospel</span>
        </div>
      ) : (
        <div className="mt-1.5 text-xs text-mist">
          today's target sits <b className="text-bone">{Math.abs(plannedDelta).toLocaleString()} kcal {plannedDelta <= 0 ? 'below' : 'above'}</b> today's burn ≈ <b className="text-bone">{r.maintenance.toLocaleString()}</b>
          {plannedDelta < 0 ? <> · planned pace ≈ {kgPerWeek(plannedDelta)} kg/week</> : null}
          <span className="block text-mist/60">
            stop eating now → ~{Math.abs(r.delta).toLocaleString()} kcal {r.delta <= 0 ? 'below' : 'above'} burn · the day isn't finished — no verdicts yet
          </span>
        </div>
      )}
    </div>
  )
}


function BodyModal({ initial, onSave, onClose }: {
  initial?: BodyLog
  onSave: (body: BodyLog | null) => void
  onClose: () => void
}) {
  const [weight, setWeight] = useState(initial?.weightKg ? String(initial.weightKg) : '')
  const [bf, setBf] = useState(initial?.bodyFatPct ? String(initial.bodyFatPct) : '')
  const [muscle, setMuscle] = useState(initial?.muscleKg ? String(initial.muscleKg) : '')
  const w = Number(weight)
  const valid = w >= 30 && w <= 300

  return (
    <Modal title="Weigh-in" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onSave({
            weightKg: Math.round(w * 10) / 10,
            bodyFatPct: Number(bf) > 0 && Number(bf) < 75 ? Math.round(Number(bf) * 10) / 10 : null,
            muscleKg: Number(muscle) > 0 && Number(muscle) < 100 ? Math.round(Number(muscle) * 10) / 10 : null,
          })
          onClose()
        }}
        className="space-y-3"
      >
        <p className="text-xs text-mist">Same scale, same time of day (morning, before eating) — the trend matters, not the single number.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Weight (kg)" type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} autoFocus />
          <Field label="Body fat % (opt.)" type="number" inputMode="decimal" step="0.1" value={bf} onChange={(e) => setBf(e.target.value)} />
          <Field label="Muscle kg (opt.)" type="number" inputMode="decimal" step="0.1" value={muscle} onChange={(e) => setMuscle(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {initial && (
            <button
              type="button"
              onClick={() => { onSave(null); onClose() }}
              className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-mist hover:text-over"
            >
              Remove
            </button>
          )}
          <button
            type="submit" disabled={!valid}
            className="flex-1 rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Mission({ goal, totals, day, foods, onRescue }: { goal: Macros; totals: Macros; day: DayDoc; foods: Food[]; onRescue: () => void }) {
  const pLeft = Math.round(goal.protein - totals.protein)
  const kLeft = Math.round(goal.kcal - totals.kcal)
  const fLeft = Math.round(goal.fat - totals.fat)
  const boozeKcal = Math.round(day.entries.filter((e) => e.alcohol).reduce((s, e) => s + e.kcal, 0))
  const shortSleep = day.sleep != null && day.sleep > 0 && day.sleep < 5
  const canRescue = pLeft > 10 && foods.some((f) => f.protein >= 10)

  let text: ReactNode
  if (pLeft > 0 && kLeft >= 0)
    text = (
      <>
        Eat <b className="text-bone">{pLeft}g more protein</b>. You have <b className="text-bone">{kLeft} kcal</b> remaining.
        {fLeft < 20 && pLeft > 25 && <> Only ~{Math.max(fLeft, 0)}g fat budget left — go lean: chicken breast, tuna, whey, fat-free yogurt.</>}
      </>
    )
  else if (pLeft > 0 && kLeft < 0)
    text = <>Still <b className="text-bone">{pLeft}g protein short</b>, {-kLeft} kcal over{boozeKcal > 300 ? <> — <span className="text-over">{boozeKcal} of it alcohol</span></> : null}. Protein first — go lean. Tomorrow is a normal day: no fasting, no punishment cardio.</>
  else if (kLeft < 0) text = <>Protein hit. <b className="text-bone">{-kLeft} kcal over</b> — stop grinding.{boozeKcal > 300 ? <> ({boozeKcal} kcal was alcohol.)</> : null}</>
  else if (kLeft > 150) text = <>Protein hit. <b className="text-bone">{kLeft} kcal</b> remaining. Carbs and fat are flexible.</>
  else text = <>Goals hit. Go lift something heavy. 🏋️</>

  if (shortSleep)
    text = (
      <>
        {text} <span className="text-carbs">😴 {day.sleep}h sleep — recovery first today: normal meals, water, early night. No heroics.</span>
      </>
    )

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-grind/30 bg-grind-soft/40 p-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-grind">Today's mission</div>
        <p className="mt-1 text-sm text-mist">{text}</p>
      </div>
      {canRescue && (
        <button
          onClick={onRescue}
          className="shrink-0 rounded-full bg-grind px-4 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          Fix it
        </button>
      )}
    </div>
  )
}

function Rescue({ foods, pGap, kcalLeft, onAdd, onClose }: {
  foods: Food[]
  pGap: number
  kcalLeft: number
  onAdd: (entry: Entry, food: Food) => void
  onClose: () => void
}) {
  const options = useMemo(() => {
    return foods
      .filter((f) => !f.alcohol && f.protein >= (isPer100(f.unit) ? 10 : 5))
      .map((f) => {
        const per100 = isPer100(f.unit)
        let amount: number
        if (per100) {
          amount = (pGap / f.protein) * 100
          if (kcalLeft > 0 && f.kcal > 0) amount = Math.min(amount, (kcalLeft / f.kcal) * 100)
          amount = Math.min(Math.max(Math.round(amount / 10) * 10, 30), 500)
        } else {
          amount = pGap / f.protein
          if (kcalLeft > 0 && f.kcal > 0) amount = Math.min(amount, kcalLeft / f.kcal)
          amount = Math.min(Math.max(Math.round(amount * 2) / 2, 0.5), 10)
        }
        const s = scaleFor(f, amount)
        return {
          food: f, amount, unit: unitOf(f),
          kcal: f.kcal * s, protein: f.protein * s, carbs: f.carbs * s, fat: f.fat * s,
        }
      })
      .filter((o) => o.protein >= pGap * 0.4)
      .sort((a, b) => b.food.protein / Math.max(b.food.kcal, 1) - a.food.protein / Math.max(a.food.kcal, 1))
      .slice(0, 5)
  }, [foods, pGap, kcalLeft])

  return (
    <Modal title={`Close the ${Math.round(pGap)}g protein gap`} onClose={onClose}>
      <p className="mb-3 text-xs text-mist">
        One tap, no math. Fits your remaining {Math.max(Math.round(kcalLeft), 0)} kcal where possible.
      </p>
      <div className="space-y-1">
        {options.map((o) => (
          <button
            key={o.food.id}
            onClick={() => {
              onAdd({
                id: crypto.randomUUID(), name: o.food.name, amount: o.amount, unit: o.unit,
                kcal: o.kcal, protein: o.protein, carbs: o.carbs, fat: o.fat,
              }, o.food)
              onClose()
            }}
            className="flex w-full items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2.5 text-left transition hover:border-grind/50"
          >
            <span className="font-medium">{fmtAmount(o)} {o.food.name}</span>
            <span className="text-xs text-mist">
              +<b className="text-grind">{Math.round(o.protein)}g P</b> · {Math.round(o.kcal)} kcal
            </span>
          </button>
        ))}
        {options.length === 0 && (
          <p className="py-4 text-center text-sm text-mist">No food in your library can close this gap. Add lean staples in Library.</p>
        )}
      </div>
    </Modal>
  )
}

function WorkoutModal({ initial, onSave, onClose }: {
  initial: Workout | null
  onSave: (w: Workout) => void
  onClose: () => void
}) {
  const [w, setW] = useState({
    type: (initial?.type ?? 'push') as WorkoutTypeId,
    duration: initial?.duration ? String(initial.duration) : '',
    kcal: initial?.kcal ? String(initial.kcal) : '',
    distance: initial?.distance ? String(initial.distance) : '',
    when: (initial?.when ?? 'before') as 'before' | 'after',
    meal: initial ? initial.meal ?? null : defaultMealNow(),
  })
  const set = (k: 'duration' | 'kcal' | 'distance') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setW({ ...w, [k]: e.target.value })

  const hasDistance = DISTANCE_TYPES.includes(w.type)

  const submit = () => {
    onSave({
      // spread first so Garmin metadata (name, HR, pace, …) survives an edit
      ...(initial ?? {}),
      id: initial?.id ?? crypto.randomUUID(),
      type: w.type,
      duration: Number(w.duration) || null,
      kcal: Number(w.kcal) || null,
      distance: hasDistance ? Number(w.distance) || null : null,
      when: w.when,
      meal: w.meal,
    })
    onClose()
  }

  const WHEN: ['before' | 'after', string][] = [['before', 'Before'], ['after', 'After']]

  return (
    <Modal title={initial ? 'Edit workout' : 'Log workout'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {WORKOUT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setW({ ...w, type: t.id })}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                w.type === t.id
                  ? 'border-grind/60 bg-grind-soft text-grind'
                  : 'border-edge bg-ink text-mist hover:text-bone'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div className={`grid gap-3 ${hasDistance ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <Field label="Minutes" type="number" inputMode="decimal" value={w.duration} onChange={set('duration')} placeholder="45" />
          <Field label="Kcal burned" type="number" inputMode="decimal" value={w.kcal} onChange={set('kcal')} placeholder="320" />
          {hasDistance && (
            <Field label="Distance (km)" type="number" inputMode="decimal" step="0.1" value={w.distance} onChange={set('distance')} placeholder="5.2" />
          )}
        </div>
        <p className="text-xs text-mist">From your watch — shown for the record, never added back to your calorie budget.</p>
        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-mist">When</span>
          <div className="mb-2 flex gap-1 rounded-full border border-edge bg-ink p-1">
            {WHEN.map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setW({ ...w, when: v })}
                className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${
                  w.when === v ? 'bg-raise text-bone' : 'text-mist'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <MealPicker meal={w.meal} setMeal={(m) => setW({ ...w, meal: m })} />
        </div>
        <button
          type="submit"
          className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          Save
        </button>
      </form>
    </Modal>
  )
}

function EditEntry({ entry, onSave, onClose }: {
  entry: Entry
  onSave: (next: Partial<Entry>) => void
  onClose: () => void
}) {
  const a0 = amountOf(entry)
  const hasAmount = a0 != null && a0 > 0
  const unit = unitOf(entry)
  const r1 = (n: number) => String(Math.round(n * 10) / 10)

  const [name, setName] = useState(entry.name)
  const [meal, setMeal] = useState<MealId | null>(entry.meal ?? null)
  const [amt, setAmt] = useState(hasAmount ? String(a0) : '')
  const [m, setM] = useState({
    kcal: r1(entry.kcal), protein: r1(entry.protein), carbs: r1(entry.carbs), fat: r1(entry.fat),
  })
  const setMacro = (k: keyof typeof m) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, [k]: e.target.value })

  const scale = hasAmount ? (Number(amt) || 0) / (a0 as number) : 1
  const valid = Boolean(name.trim()) && (hasAmount ? Number(amt) > 0 : m.kcal !== '')

  const submit = () => {
    if (!valid) return
    onSave(
      hasAmount
        ? {
            name: name.trim(), meal, amount: Number(amt), unit, grams: null,
            alcoholG: entry.alcoholG ? entry.alcoholG * scale : entry.alcoholG ?? null,
            kcal: entry.kcal * scale, protein: entry.protein * scale,
            carbs: entry.carbs * scale, fat: entry.fat * scale,
          }
        : {
            name: name.trim(), meal,
            kcal: Number(m.kcal) || 0, protein: Number(m.protein) || 0,
            carbs: Number(m.carbs) || 0, fat: Number(m.fat) || 0,
          },
    )
    onClose()
  }

  return (
    <Modal title="Edit entry" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <MealPicker meal={meal} setMeal={setMeal} />
        {hasAmount ? (
          <>
            <Field
              label={isPer100(unit) ? `Amount (${unit})` : `${unit}s`}
              type="number" inputMode="decimal" autoFocus
              step={isPer100(unit) ? '1' : '0.5'}
              value={amt} onChange={(e) => setAmt(e.target.value)}
            />
            <div className="text-sm text-mist">
              = {Math.round(entry.kcal * scale)} kcal · P {Math.round(entry.protein * scale)} · C {Math.round(entry.carbs * scale)} · F {Math.round(entry.fat * scale)}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Calories" type="number" inputMode="decimal" value={m.kcal} onChange={setMacro('kcal')} autoFocus />
            <Field label="Protein (g)" type="number" inputMode="decimal" value={m.protein} onChange={setMacro('protein')} />
            <Field label="Carbs (g)" type="number" inputMode="decimal" value={m.carbs} onChange={setMacro('carbs')} />
            <Field label="Fat (g)" type="number" inputMode="decimal" value={m.fat} onChange={setMacro('fat')} />
          </div>
        )}
        <button
          type="submit" disabled={!valid}
          className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Save
        </button>
      </form>
    </Modal>
  )
}

// projected macros after adding `add` to today's totals
function MacroImpact({ totals, goal, add }: { totals: Macros; goal: Macros; add: Macros }) {
  const after: Macros = {
    kcal: totals.kcal + add.kcal,
    protein: totals.protein + add.protein,
    carbs: totals.carbs + add.carbs,
    fat: totals.fat + add.fat,
  }
  const kcalR = goal.kcal > 0 ? after.kcal / goal.kcal : 0
  const flexCls = kcalR <= 1 ? 'text-grind' : kcalR <= 1.05 ? 'text-carbs' : 'text-over'
  const rows: { label: string; now: number; aft: number; g: number; cls: string }[] = [
    { label: 'Calories', now: totals.kcal, aft: after.kcal, g: goal.kcal,
      cls: kcalR > 1.1 ? 'text-over' : kcalR >= 0.9 ? 'text-grind' : 'text-carbs' },
    { label: 'Protein', now: totals.protein, aft: after.protein, g: goal.protein,
      cls: after.protein >= goal.protein ? 'text-grind' : after.protein >= goal.protein * 0.8 ? 'text-carbs' : 'text-bone' },
    { label: 'Carbs', now: totals.carbs, aft: after.carbs, g: goal.carbs, cls: flexCls },
    { label: 'Fat', now: totals.fat, aft: after.fat, g: goal.fat, cls: flexCls },
  ]
  return (
    <div className="space-y-1 rounded-lg border border-edge bg-ink p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mist">After adding</div>
      {rows.map(({ label, now, aft, g, cls }) => (
        <div key={label} className="flex items-center justify-between text-xs">
          <span className="text-mist">{label}</span>
          <span className="tabular-nums text-mist">
            {Math.round(now)} → <b className={cls}>{Math.round(aft)}</b> / {Math.round(g)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function MealPicker({ meal, setMeal }: { meal: MealId | null; setMeal: (m: MealId | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MEALS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setMeal(meal === m.id ? null : m.id)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            meal === m.id
              ? 'border-grind/60 bg-grind-soft text-grind'
              : 'border-edge bg-ink text-mist hover:text-bone'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

interface AddFoodProps {
  foods: Food[]
  addFood: FoodsApi['addFood']
  bumpUsed: (f: Food) => void
  totals: Macros
  goal: Macros
  onAdd: (entry: Entry) => void
  onClose: () => void
}

function AddFood({ foods, addFood, bumpUsed, totals, goal, onAdd, onClose }: AddFoodProps) {
  const [mode, setMode] = useState<'library' | 'quick'>('library')
  const [meal, setMeal] = useState<MealId | null>(defaultMealNow())
  const addWithMeal = (entry: Entry) => onAdd({ ...entry, meal })

  const TABS: ['library' | 'quick', string][] = [['library', 'My foods'], ['quick', 'Quick add']]

  return (
    <Modal title="Add food" onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-full border border-edge bg-ink p-1">
        {TABS.map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${
              mode === m ? 'bg-raise text-bone' : 'text-mist'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-4">
        <MealPicker meal={meal} setMeal={setMeal} />
      </div>
      {mode === 'library'
        ? <FromLibrary foods={foods} bumpUsed={bumpUsed} totals={totals} goal={goal} onAdd={addWithMeal} onClose={onClose} />
        : <QuickAdd addFood={addFood} totals={totals} goal={goal} onAdd={addWithMeal} onClose={onClose} />}
    </Modal>
  )
}

// frecency: usage count decayed by ~3%/day since last use (half-life ≈ 3 weeks)
const frecency = (f: Food): number => {
  if (!f.used) return 0
  const days = f.lastUsed ? (Date.now() - f.lastUsed) / 86400000 : 30
  return f.used * Math.pow(0.97, days)
}

const matchRank = (name: string, q: string): number => {
  const n = name.toLowerCase()
  if (n.startsWith(q)) return 0
  if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1
  return 2
}

function FromLibrary({ foods, bumpUsed, totals, goal, onAdd, onClose }: Omit<AddFoodProps, 'addFood'>) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Food | null>(null)
  const [grams, setGrams] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return foods
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (q) {
          const r = matchRank(a.name, q) - matchRank(b.name, q)
          if (r !== 0) return r
        }
        return frecency(b) - frecency(a) || a.name.localeCompare(b.name)
      })
  }, [foods, search])

  const frequent = useMemo(
    () => foods.filter((f) => f.used).sort((a, b) => frecency(b) - frecency(a)).slice(0, 6),
    [foods],
  )

  const pick = (f: Food) => {
    setPicked(f)
    setGrams(isPer100(f.unit) ? (f.serving ? String(f.serving) : '100') : '1')
  }

  if (picked) {
    const per100 = isPer100(picked.unit)
    const unit = unitOf(picked)
    const amt = Number(grams) || 0
    const scale = scaleFor(picked, amt)
    const add = () => {
      if (amt <= 0) return
      onAdd({
        id: crypto.randomUUID(),
        name: picked.name,
        amount: amt,
        unit,
        alcohol: !!picked.alcohol,
        alcoholG: picked.alcohol && picked.alcoholG ? picked.alcoholG * scale : null,
        kcal: picked.kcal * scale,
        protein: picked.protein * scale,
        carbs: picked.carbs * scale,
        fat: picked.fat * scale,
      })
      bumpUsed(picked)
      onClose()
    }
    return (
      <form onSubmit={(e) => { e.preventDefault(); add() }} className="space-y-4">
        <div className="rounded-lg border border-edge bg-ink p-3">
          <div className="font-medium">{picked.name}</div>
          <div className="text-xs text-mist">
            {basisLabel(picked)}: {picked.kcal} kcal · P {picked.protein} · C {picked.carbs} · F {picked.fat}
          </div>
        </div>
        <Field
          label={per100 ? `Amount (${unit})` : `${unit}s`}
          type="number" inputMode="decimal" autoFocus
          step={per100 ? '1' : '0.5'}
          value={grams} onChange={(e) => setGrams(e.target.value)}
          placeholder={per100 ? (picked.serving ? String(picked.serving) : '100') : '1'}
        />
        <div className="text-sm text-mist">
          = {Math.round(picked.kcal * scale)} kcal · P {Math.round(picked.protein * scale)} · C {Math.round(picked.carbs * scale)} · F {Math.round(picked.fat * scale)}
        </div>
        <MacroImpact
          totals={totals}
          goal={goal}
          add={{
            kcal: picked.kcal * scale, protein: picked.protein * scale,
            carbs: picked.carbs * scale, fat: picked.fat * scale,
          }}
        />
        <div className="flex gap-2">
          <button type="button" onClick={() => setPicked(null)} className="flex-1 rounded-full border border-edge py-2.5 text-sm font-medium text-mist hover:text-bone">
            Back
          </button>
          <button
            type="submit"
            disabled={amt <= 0}
            className="flex-1 rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-3">
      <Field label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chicken breast…" autoFocus />
      {frequent.length > 0 && !search && (
        <div className="flex flex-wrap gap-1.5">
          {frequent.map((f) => (
            <button
              key={f.id}
              onClick={() => pick(f)}
              className={`rounded-full border border-edge bg-raise px-3 py-1 text-xs font-medium transition ${
                f.alcohol ? 'text-over hover:border-over/50' : 'text-mist hover:border-grind/50 hover:text-bone'
              }`}
            >
              {f.alcohol ? '🍺 ' : ''}{f.name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {filtered.map((f) => (
          <button
            key={f.id}
            onClick={() => pick(f)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition hover:bg-raise"
          >
            <span className={`font-medium ${f.alcohol ? 'text-over' : ''}`}>{f.alcohol ? '🍺 ' : ''}{f.name}</span>
            <span className="text-xs text-mist">{f.kcal} kcal {basisLabel(f)}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-mist">
            {foods.length === 0 ? 'Nothing in your library yet — add staples in the Library tab, or use Quick add.' : 'No match.'}
          </p>
        )}
      </div>
    </div>
  )
}

function QuickAdd({ addFood, totals, goal, onAdd, onClose }: Omit<AddFoodProps, 'foods' | 'bumpUsed'>) {
  const [f, setF] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '' })
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  const [alcohol, setAlcohol] = useState(false)
  const [alcoholG, setAlcoholG] = useState('')
  const set = (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const valid = Boolean(f.name.trim()) && Number(f.kcal) >= 0 && f.kcal !== ''

  const submit = () => {
    if (!valid) return
    const entry: Entry = {
      id: crypto.randomUUID(),
      name: f.name.trim(),
      amount: null,
      unit: null,
      alcohol,
      alcoholG: alcohol ? Number(alcoholG) || 0 : null,
      kcal: Number(f.kcal) || 0,
      protein: Number(f.protein) || 0,
      carbs: Number(f.carbs) || 0,
      fat: Number(f.fat) || 0,
    }
    onAdd(entry)
    if (saveToLibrary) {
      addFood({
        name: entry.name, unit: 'g', alcohol, alcoholG: entry.alcoholG,
        kcal: entry.kcal, protein: entry.protein,
        carbs: entry.carbs, fat: entry.fat, serving: null,
      })
    }
    onClose()
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-3">
      <Field label="Name" value={f.name} onChange={set('name')} placeholder="Ribeye 300g" autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Calories" type="number" inputMode="decimal" value={f.kcal} onChange={set('kcal')} />
        <Field label="Protein (g)" type="number" inputMode="decimal" value={f.protein} onChange={set('protein')} />
        <Field label="Carbs (g)" type="number" inputMode="decimal" value={f.carbs} onChange={set('carbs')} />
        <Field label="Fat (g)" type="number" inputMode="decimal" value={f.fat} onChange={set('fat')} />
      </div>
      {valid && (
        <MacroImpact
          totals={totals}
          goal={goal}
          add={{
            kcal: Number(f.kcal) || 0, protein: Number(f.protein) || 0,
            carbs: Number(f.carbs) || 0, fat: Number(f.fat) || 0,
          }}
        />
      )}
      <label className="flex items-center gap-2 text-sm text-mist">
        <input
          type="checkbox" checked={alcohol}
          onChange={(e) => setAlcohol(e.target.checked)}
          className="size-4 accent-(--color-over)"
        />
        🍺 Alcohol <span className="text-xs text-over">(logs in red, no hiding)</span>
      </label>
      {alcohol && (
        <Field
          label="Alcohol (g)" type="number" inputMode="decimal" step="0.1"
          value={alcoholG} onChange={(e) => setAlcoholG(e.target.value)} placeholder="e.g. 28"
        />
      )}
      <label className="flex items-center gap-2 text-sm text-mist">
        <input
          type="checkbox" checked={saveToLibrary}
          onChange={(e) => setSaveToLibrary(e.target.checked)}
          className="size-4 accent-(--color-grind)"
        />
        Also save to my foods (as per-100g values)
      </label>
      <button
        type="submit"
        disabled={!valid}
        className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
      >
        Add to log
      </button>
    </form>
  )
}
