import type { Workout, WorkoutSet, WorkoutTypeId } from '../types'

export const WORKOUT_TYPES: { id: WorkoutTypeId; label: string; icon: string }[] = [
  { id: 'push', label: 'Push', icon: '🏋️' },
  { id: 'legs', label: 'Legs', icon: '🏋️' },
  { id: 'pull', label: 'Pull', icon: '🏋️' },
  { id: 'strength', label: 'Strength', icon: '🏋️' },
  { id: 'run', label: 'Run', icon: '🏃' },
  { id: 'walk', label: 'Walk', icon: '🚶' },
  { id: 'ride', label: 'Ride', icon: '🚴' },
  { id: 'swim', label: 'Swim', icon: '🏊' },
  { id: 'hike', label: 'Hike', icon: '🥾' },
  { id: 'stairs', label: 'Stairs', icon: '🪜' },
  { id: 'cardio', label: 'Cardio', icon: '⚡' },
  { id: 'other', label: 'Other', icon: '🎯' },
]

const FALLBACK = WORKOUT_TYPES[WORKOUT_TYPES.length - 1]

// lift-split types read as "<Label> day"
const DAY_TYPES: WorkoutTypeId[] = ['push', 'legs', 'pull']

// distance makes sense for these
export const DISTANCE_TYPES: WorkoutTypeId[] = ['run', 'walk', 'ride', 'swim', 'hike']

// live set-logging applies to these
export const STRENGTH_TYPES: WorkoutTypeId[] = ['push', 'legs', 'pull', 'strength']

const isWarmup = (s: Pick<WorkoutSet, 'warmup' | 'setType'>): boolean =>
  Boolean(s.warmup) || s.setType === 'warmup'

/** external load moved in one set — the only number tonnage may count.
 *  Bodyweight/assisted sets contribute 0 (assistance is help, not load);
 *  per-hand loads (dumbbells) count both hands. */
export const setLoadKg = (s: WorkoutSet): number => {
  if (isWarmup(s)) return 0
  if (s.loadType === 'bodyweight' || s.loadType === 'assistance') return 0
  return (s.weightKg ?? 0) * (s.loadPerHand ? 2 : 1) * (s.reps ?? 0)
}

export const setLabel = (s: WorkoutSet): string => {
  const load =
    s.loadType === 'assistance' ? `asst${s.assistanceKg ?? s.weightKg ?? '?'}`
    : s.loadType === 'bodyweight' || (!s.weightKg && !s.assistanceKg) ? 'bw'
    : `${s.weightKg}${s.loadPerHand ? '/hand' : ''}`
  const flags = `${isWarmup(s) ? 'ᵂ' : ''}${s.setType === 'drop' ? 'ᵈ' : ''}${s.toFailure ? '!' : ''}${s.rir != null ? `@${s.rir}RIR` : ''}`
  return `${load}×${s.reps ?? '?'}${flags}`
}

/** consecutive sets grouped per exercise, labels compressed ("35/hand×8 ×2") */
export interface ExerciseGroup {
  exercise: string
  labels: string[]
  sets: WorkoutSet[]
  volumeKg: number
  groupId?: string | null
  groupType?: string | null
}

export const setsByExercise = (w: Pick<Workout, 'sets'>): ExerciseGroup[] => {
  const groups: ExerciseGroup[] = []
  for (const s of w.sets ?? []) {
    const last = groups[groups.length - 1]
    if (last && last.exercise === s.exercise) {
      last.sets.push(s)
      last.volumeKg += setLoadKg(s)
    } else {
      groups.push({ exercise: s.exercise, labels: [], sets: [s], volumeKg: setLoadKg(s), groupId: s.groupId, groupType: s.groupType })
    }
  }
  for (const g of groups) {
    // compress identical consecutive labels: "35/hand×8, 35/hand×8" → "35/hand×8 ×2"
    const raw = g.sets.map(setLabel)
    const out: string[] = []
    let count = 0
    for (let i = 0; i < raw.length; i++) {
      count++
      if (raw[i] !== raw[i + 1]) {
        out.push(count > 1 ? `${raw[i]} ×${count}` : raw[i])
        count = 0
      }
    }
    g.labels = out
  }
  return groups
}

/** "Bench press 80×8, 80×8 · Dips asst9×14 · DB Press 35/hand×8" */
export const setsSummary = (w: Pick<Workout, 'sets'>): string => {
  if (!w.sets?.length) return ''
  const parts: string[] = []
  let current = ''
  for (const s of w.sets) {
    const rep = setLabel(s)
    if (s.exercise === current) parts[parts.length - 1] += `, ${rep}`
    else {
      current = s.exercise
      parts.push(`${s.exercise} ${rep}`)
    }
  }
  return parts.join(' · ')
}

/** working external volume in kg — see setLoadKg for the semantics */
export const setsVolume = (w: Pick<Workout, 'sets'>): number =>
  (w.sets ?? []).reduce((v, s) => v + setLoadKg(s), 0)

/** working (non-warm-up) set count */
export const workingSets = (w: Pick<Workout, 'sets'>): number =>
  (w.sets ?? []).filter((s) => !isWarmup(s)).length

export const workoutType = (id: WorkoutTypeId) =>
  WORKOUT_TYPES.find((t) => t.id === id) ?? FALLBACK

export const workoutTitle = (w: Pick<Workout, 'type' | 'name'>): string => {
  // Garmin's own activity name is the most specific label we have
  if (w.name?.trim()) return w.name.trim()
  const t = workoutType(w.type)
  return DAY_TYPES.includes(t.id) ? `${t.label} day` : t.label
}

// 5.53 → "5:32 /km"
export const fmtPace = (minPerKm: number): string => {
  const m = Math.floor(minPerKm)
  const s = Math.round((minPerKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')} /km`
}

// "38 min · 481 kcal · 5.2 km · 5:32 /km · ♥ 142 (max 167) · ↑86m"
export const workoutDetails = (
  w: Pick<Workout, 'duration' | 'kcal' | 'distance' | 'avgHr' | 'maxHr' | 'paceMinKm' | 'speedKmh' | 'elevM' | 'cadence'>,
): string =>
  [
    w.duration ? `${w.duration} min` : null,
    w.kcal ? `${w.kcal} kcal` : null,
    w.distance ? `${w.distance} km` : null,
    w.paceMinKm ? fmtPace(w.paceMinKm) : null,
    w.speedKmh ? `${w.speedKmh} km/h` : null,
    w.avgHr ? `♥ ${w.avgHr}${w.maxHr ? ` (max ${w.maxHr})` : ''}` : null,
    w.elevM ? `↑${w.elevM}m` : null,
    w.cadence ? `${w.cadence} spm` : null,
  ]
    .filter(Boolean)
    .join(' · ')
