import { fmtLong, fmtDay } from './dates'
import { fmtAmount } from './units'
import { MEALS } from './meals'
import { workoutTitle, workoutDetails } from './workouts'
import { totalsOf, goalFor } from '../hooks/useData'
import { scoreDay, stepsOf, MAX_POINTS } from './score'
import { energyReadout } from './coach'
import type { DayDoc, Macros, Settings } from '../types'

const r = (n: number) => Math.round(n * 10) / 10
const line = (t: Macros) =>
  `${Math.round(t.kcal)} kcal | P ${r(t.protein)}g | C ${r(t.carbs)}g | F ${r(t.fat)}g`

export function dayReport(key: string, day: DayDoc, settings: Settings): string {
  const goal = goalFor(settings, day)
  const totals = totalsOf(day)
  const tag = settings.trainingEnabled ? (day.training ? ' — Training day' : ' — Rest day') : ''

  const known = new Set<string>(MEALS.map((m) => m.id))
  const workouts = day.workouts ?? []
  const groups = [
    ...MEALS.map((m) => ({
      label: m.label,
      entries: day.entries.filter((e) => e.meal === m.id),
      workouts: workouts.filter((w) => w.meal === m.id),
    })),
    {
      label: 'Unsorted',
      entries: day.entries.filter((e) => !known.has(e.meal ?? '')),
      workouts: workouts.filter((w) => !known.has(w.meal ?? '')),
    },
  ].filter((g) => g.entries.length || g.workouts.length)

  const entries = groups.length
    ? groups
        .flatMap((g) => [
          g.entries.length ? `${g.label} — ${line(totalsOf({ entries: g.entries }))}:` : `${g.label}:`,
          ...g.workouts
            .filter((w) => w.when !== 'after')
            .map((w) => `- [Training, before ${g.label.toLowerCase()}] ${workoutTitle(w)}${workoutDetails(w) ? ` — ${workoutDetails(w)} (burn not counted in budget)` : ''}`),
          ...g.entries.map((e) => `- ${e.alcohol ? '[Alcohol] ' : ''}${e.name}${fmtAmount(e) ? ` (${fmtAmount(e)})` : ''}: ${line(e)}`),
          ...g.workouts
            .filter((w) => w.when === 'after')
            .map((w) => `- [Training, after ${g.label.toLowerCase()}] ${workoutTitle(w)}${workoutDetails(w) ? ` — ${workoutDetails(w)} (burn not counted in budget)` : ''}`),
        ])
        .join('\n')
    : '- nothing logged'

  return [
    `# Meat Grinder — Daily log — ${fmtLong(key)}${tag}`,
    `Goal: ${line(goal)}`,
    `Eaten: ${line(totals)}`,
    `Remaining: ${line({
      kcal: goal.kcal - totals.kcal,
      protein: goal.protein - totals.protein,
      carbs: goal.carbs - totals.carbs,
      fat: goal.fat - totals.fat,
    })}`,
    ...(() => {
      const extra: string[] = []
      if (settings.profile) {
        const r = energyReadout(settings.profile, day, totals.kcal)
        extra.push(
          `Energy: ${r.eaten} kcal eaten vs ~${r.maintenance} burned${r.exerciseKcal ? ` (incl. ${r.exerciseKcal} exercise)` : ''} → ${r.delta > 0 ? '+' : ''}${r.delta} kcal · ${r.zone.label}${r.zone.id !== 'maintenance' ? ` ≈ ${r.kgWeek > 0 ? '+' : ''}${r.kgWeek} kg/week at this pace` : ''}`,
        )
      }
      if (day.sleep) extra.push(`Sleep last night: ${day.sleep}h`)
      const steps = stepsOf(day) || null
      if (steps) extra.push(`Steps: ${steps.toLocaleString()}${day.steps ? ' (manual)' : ' (Garmin)'}`)
      if (day.garmin?.restingHr) extra.push(`Resting HR: ${day.garmin.restingHr} bpm (Garmin)`)
      const score = scoreDay(day, settings)
      extra.push(`Leaderboard score: ${score.points}/${MAX_POINTS} pts`)
      const booze = day.entries.filter((e) => e.alcohol)
      const shame = booze.reduce((s, e) => s + e.kcal, 0)
      const grams = booze.reduce((s, e) => s + (e.alcoholG || 0), 0)
      if (shame > 0) extra.push(`Alcohol: ${Math.round(shame)} kcal${grams > 0 ? `, ${Math.round(grams)}g pure alcohol` : ''} (included in totals)`)
      return extra
    })(),
    '',
    '## Entries',
    entries,
  ].join('\n')
}

export function rangeReport(
  title: string,
  keys: string[],
  daysByKey: Record<string, DayDoc>,
  settings: Settings,
): string {
  const logged = keys.filter((k) => daysByKey[k]?.entries?.length)

  const rows = keys.flatMap((k) => {
    const day = daysByKey[k]
    if (!day?.entries?.length) return [`- ${fmtDay(k)} (${k}): no entries`]
    const goal = goalFor(settings, day)
    const t = totalsOf(day)
    const tag = settings.trainingEnabled && day.training ? ' [training]' : ''
    const trained = day.workouts?.length
      ? ` | trained: ${day.workouts.map((w) => `${workoutTitle(w)}${workoutDetails(w) ? ` (${workoutDetails(w)})` : ''}`).join(', ')}`
      : ''
    const sleep = day.sleep ? ` | sleep ${day.sleep}h` : ''
    const steps = stepsOf(day) || null
    const wellness = [
      steps ? ` | steps ${steps}` : '',
      day.garmin?.restingHr ? ` | resting HR ${day.garmin.restingHr}` : '',
    ].join('')
    const drinks = day.entries.filter((e) => e.alcohol)
    const shame = drinks.reduce((s, e) => s + e.kcal, 0)
    const grams = drinks.reduce((s, e) => s + (e.alcoholG || 0), 0)
    const booze = shame > 0 ? ` | alcohol ${Math.round(shame)} kcal${grams > 0 ? ` (${Math.round(grams)}g)` : ''}` : ''
    return [
      `- ${fmtDay(k)} (${k})${tag}: ${line(t)} (goal ${Math.round(goal.kcal)} kcal)${trained}${sleep}${wellness}${booze}`,
      ...day.entries.map((e) => `  - ${e.alcohol ? '[Alcohol] ' : ''}${e.name}${fmtAmount(e) ? ` (${fmtAmount(e)})` : ''}: ${line(e)}`),
    ]
  })

  let avg = 'No days logged.'
  if (logged.length) {
    const sum = logged.reduce(
      (a, k) => {
        const t = totalsOf(daysByKey[k])
        return {
          kcal: a.kcal + t.kcal, protein: a.protein + t.protein,
          carbs: a.carbs + t.carbs, fat: a.fat + t.fat,
        }
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    )
    const n = logged.length
    avg = `Average over ${n} logged day${n > 1 ? 's' : ''}: ${line({
      kcal: sum.kcal / n, protein: sum.protein / n, carbs: sum.carbs / n, fat: sum.fat / n,
    })}`
  }

  let compliance = ''
  if (logged.length) {
    const hits = logged.map((k) => {
      const g = goalFor(settings, daysByKey[k])
      const t = totalsOf(daysByKey[k])
      return (t.protein >= g.protein * 0.95 ? 1 : 0) + (t.kcal >= g.kcal * 0.9 && t.kcal <= g.kcal * 1.1 ? 1 : 0)
    })
    compliance = `Compliance: ${Math.round((hits.reduce((a, b) => a + b, 0) / (logged.length * 2)) * 100)}% (protein ≥95% of goal, kcal within ±10%)`
  }

  let energy = ''
  if (settings.profile) {
    const counted = logged.map((k) => energyReadout(settings.profile!, daysByKey[k], totalsOf(daysByKey[k]).kcal))
    if (counted.length) {
      const total = counted.reduce((s2, r2) => s2 + r2.delta, 0)
      const kg = Math.round((total / 7700) * 100) / 100
      energy = `Energy balance over ${counted.length} logged days: ${total > 0 ? '+' : ''}${total} kcal vs burn (incl. exercise) → implied weight change ≈ ${kg > 0 ? '+' : ''}${kg} kg (estimates; unlogged days excluded)`
    }
  }

  return [
    `# Meat Grinder — ${title}`,
    `Goals: rest ${line(settings.rest)}${settings.trainingEnabled ? ` | training ${line(settings.training)}` : ''}`,
    ...[avg, compliance, energy].filter(Boolean),
    '',
    '## Days',
    ...rows,
  ].join('\n')
}
