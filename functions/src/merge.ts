// Pure merge logic between live-logged strength sets and Garmin strength
// activities. No Firestore here so it can be unit-tested directly.
//
// The two can arrive in either order:
//   sets first  → the Garmin activity MERGES onto the sets card (sync path)
//   Garmin first → logSets ADOPTS the Garmin card (logSets path)
// and a re-sync HEALS an earlier miss (Garmin-only card + separate sets card).

export const STRENGTH_FAMILY = ['push', 'legs', 'pull', 'strength'] as const
const DAY_TYPES = ['push', 'legs', 'pull']
const WINDOW_MS = 3 * 3600_000

export interface MergeWorkout {
  id: string
  type: string
  garminId?: number
  name?: string | null
  duration?: number | null
  kcal?: number | null
  distance?: number | null
  when?: string
  meal?: string
  sets?: unknown[]
  startedAt?: number | null
  avgHr?: number | null
  maxHr?: number | null
  paceMinKm?: number | null
  speedKmh?: number | null
  elevM?: number | null
  cadence?: number | null
  [k: string]: unknown
}

export interface GarminAct {
  activityId: number
  /** app workout type, already mapped */
  type: string
  name: string | null
  /** epoch ms of the activity start */
  startMs: number
  durationMin: number | null
  kcal: number | null
  distanceKm: number | null
  meal: string
  metrics: Partial<Pick<MergeWorkout, 'avgHr' | 'maxHr' | 'paceMinKm' | 'speedKmh' | 'elevM' | 'cadence'>>
}

export const isStrength = (type: string): boolean => (STRENGTH_FAMILY as readonly string[]).includes(type)

/** Garmin's generic "Strength" label must not overwrite a specific split day */
export const mergedName = (type: string, garminName: string | null, current: string | null | undefined): string | null =>
  DAY_TYPES.includes(type) ? null : garminName ?? current ?? null

/** nearest-in-time pick, conservative: a lone candidate always matches (logging
 *  time is often hours after the session); several candidates need a startedAt
 *  within the window so two real sessions on one day never collapse */
const pickNearest = (pool: MergeWorkout[], refMs: number | null): MergeWorkout | null => {
  if (!pool.length) return null
  if (pool.length === 1) return pool[0]
  if (refMs == null) return null
  let best: MergeWorkout | null = null
  let bestGap = WINDOW_MS
  for (const w of pool) {
    if (w.startedAt == null) continue
    const gap = Math.abs(w.startedAt - refMs)
    if (gap < bestGap) { best = w; bestGap = gap }
  }
  return best
}

/** live-logged sets card the watch's activity should land on */
export const pickSetsCard = (workouts: MergeWorkout[], actStartMs: number): MergeWorkout | null =>
  pickNearest(
    workouts.filter((w) => !w.garminId && isStrength(w.type) && (w.sets?.length ?? 0) > 0),
    actStartMs,
  )

/** Garmin-only strength card (no sets yet) that new live sets should adopt */
export const pickGarminShell = (workouts: MergeWorkout[], nowMs: number): MergeWorkout | null =>
  pickNearest(
    workouts.filter((w) => w.garminId && isStrength(w.type) && !(w.sets?.length ?? 0)),
    nowMs,
  )

const attachGarmin = (target: MergeWorkout, act: GarminAct) => {
  target.garminId = act.activityId
  target.name = mergedName(target.type, act.name, target.name)
  if (act.durationMin) target.duration = act.durationMin
  if (act.kcal) target.kcal = act.kcal
  if (target.startedAt == null) target.startedAt = act.startMs
  Object.assign(target, act.metrics)
}

export type IngestAction = 'added' | 'merged' | 'healed' | 'backfilled' | 'unchanged'

/** apply one Garmin activity to a day's workouts (mutates + returns the list) */
export function ingestGarminActivity(
  workouts: MergeWorkout[],
  act: GarminAct,
  newId: () => string,
): { workouts: MergeWorkout[]; action: IngestAction } {
  const existing = workouts.find((w) => w.garminId === act.activityId)

  if (existing) {
    // HEAL: the activity landed before the sets were logged, so a Garmin-only
    // shell and a separate sets card coexist — fold the shell into the sets
    if (isStrength(act.type) && !(existing.sets?.length ?? 0)) {
      const target = pickSetsCard(workouts, act.startMs)
      if (target) {
        attachGarmin(target, act)
        return { workouts: workouts.filter((w) => w !== existing), action: 'healed' }
      }
    }
    // backfill metrics onto workouts synced before we captured them
    if (existing.avgHr == null && (act.metrics.avgHr != null || act.metrics.paceMinKm != null || act.metrics.elevM != null)) {
      Object.assign(existing, act.metrics)
      return { workouts, action: 'backfilled' }
    }
    return { workouts, action: 'unchanged' }
  }

  // MERGE: sets were logged live during this session
  if (isStrength(act.type)) {
    const target = pickSetsCard(workouts, act.startMs)
    if (target) {
      attachGarmin(target, act)
      return { workouts, action: 'merged' }
    }
  }

  workouts.push({
    id: newId(),
    garminId: act.activityId,
    type: act.type,
    name: act.name,
    duration: act.durationMin,
    kcal: act.kcal,
    distance: act.distanceKm,
    when: 'before',
    meal: act.meal,
    startedAt: act.startMs,
    ...act.metrics,
  })
  return { workouts, action: 'added' }
}
