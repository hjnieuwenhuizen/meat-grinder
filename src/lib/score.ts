// Daily score for the family leaderboard. Percent-of-own-goal, so different
// goals compete fairly. Pure — no Firestore here.
import { totalsOf, goalFor } from '../hooks/useData'
import { applyFuel } from './coach'
import type { ChallengeMetric, DayDoc, ScoreBreakdown, ScoreDoc, Settings } from '../types'

export const STEP_GOAL = 7000

/** manual steps win over Garmin */
// typed value wins; then Garmin (the watch is the authority when connected);
// phone Health Connect only fills days Garmin didn't cover
export const stepsOf = (day: Pick<DayDoc, 'steps' | 'garmin' | 'health'> | null | undefined): number =>
  day?.steps ?? day?.garmin?.steps ?? day?.health?.steps ?? 0

export const SCORE_ITEMS: { key: keyof ScoreBreakdown; emoji: string; label: string; max: number }[] = [
  { key: 'logged', emoji: '📓', label: 'Logged food', max: 1 },
  { key: 'protein', emoji: '🥩', label: 'Protein target hit', max: 3 },
  { key: 'kcal', emoji: '🟢', label: 'Calories in the green (90–110%)', max: 3 },
  { key: 'workout', emoji: '💪', label: 'Worked out', max: 2 },
  { key: 'steps', emoji: '👟', label: `${STEP_GOAL.toLocaleString()}+ steps`, max: 2 },
  { key: 'sleep', emoji: '😴', label: '7h+ sleep', max: 1 },
  { key: 'dry', emoji: '🚱', label: 'Alcohol-free', max: 1 },
  { key: 'perfect', emoji: '👑', label: 'Perfect day (protein + green)', max: 1 },
]

export const MAX_POINTS = SCORE_ITEMS.reduce((s, i) => s + i.max, 0)

export function scoreDay(day: DayDoc, settings: Settings): { points: number; steps: number; km: number; breakdown: ScoreBreakdown } {
  const { goal } = applyFuel(goalFor(settings, day), day, settings.profile)
  const totals = totalsOf(day)
  const logged = day.entries.length > 0
  const steps = stepsOf(day)
  const ratio = goal.kcal > 0 ? totals.kcal / goal.kcal : 0

  const protein = logged && goal.protein > 0 && totals.protein >= goal.protein
  const kcal = logged && ratio >= 0.9 && ratio <= 1.1

  const breakdown: ScoreBreakdown = {
    logged: logged ? 1 : 0,
    protein: protein ? 3 : 0,
    kcal: kcal ? 3 : 0,
    workout: (day.workouts?.length ?? 0) > 0 ? 2 : 0,
    steps: steps >= STEP_GOAL ? 2 : 0,
    sleep: (day.sleep ?? 0) >= 7 ? 1 : 0,
    dry: logged && !day.entries.some((e) => e.alcohol) ? 1 : 0,
    perfect: protein && kcal ? 1 : 0,
  }
  const points = Object.values(breakdown).reduce((a, b) => a + b, 0)
  const km = Math.round((day.workouts ?? []).reduce((s, w) => s + (w.distance || 0), 0) * 10) / 10
  return { points, steps, km, breakdown }
}

/* --- challenge metrics: how to sum a member's score docs over a date range --- */

export const METRICS: Record<ChallengeMetric, { emoji: string; label: string; of: (s: ScoreDoc) => number; fmt: (n: number) => string }> = {
  steps: { emoji: '👟', label: 'Total steps', of: (s) => s.steps, fmt: (n) => n.toLocaleString() },
  points: { emoji: '🏆', label: 'Total points', of: (s) => s.points, fmt: (n) => `${n} pts` },
  km: { emoji: '🏃', label: 'Distance', of: (s) => s.km ?? 0, fmt: (n) => `${Math.round(n * 10) / 10} km` },
  workoutDays: { emoji: '💪', label: 'Workout days', of: (s) => (s.breakdown?.workout > 0 ? 1 : 0), fmt: (n) => `${n} days` },
  proteinDays: { emoji: '🥩', label: 'Protein-hit days', of: (s) => (s.breakdown?.protein > 0 ? 1 : 0), fmt: (n) => `${n} days` },
  greenDays: { emoji: '🟢', label: 'Green days', of: (s) => (s.breakdown?.kcal > 0 ? 1 : 0), fmt: (n) => `${n} days` },
  dryDays: { emoji: '🚱', label: 'Alcohol-free days', of: (s) => (s.breakdown?.dry > 0 ? 1 : 0), fmt: (n) => `${n} days` },
}
