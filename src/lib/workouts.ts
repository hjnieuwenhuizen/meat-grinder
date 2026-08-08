import type { Workout, WorkoutTypeId } from '../types'

export const WORKOUT_TYPES: { id: WorkoutTypeId; label: string; icon: string }[] = [
  { id: 'push', label: 'Push', icon: '🏋️' },
  { id: 'legs', label: 'Legs', icon: '🏋️' },
  { id: 'pull', label: 'Pull', icon: '🏋️' },
  { id: 'run', label: 'Run', icon: '🏃' },
  { id: 'other', label: 'Other', icon: '⚡' },
]

export const workoutType = (id: WorkoutTypeId) =>
  WORKOUT_TYPES.find((t) => t.id === id) ?? WORKOUT_TYPES[4]

export const workoutTitle = (w: Pick<Workout, 'type'>): string => {
  const t = workoutType(w.type)
  return t.id === 'run' || t.id === 'other' ? t.label : `${t.label} day`
}

// "45 min · 320 kcal · 5.2 km"
export const workoutDetails = (w: Pick<Workout, 'duration' | 'kcal' | 'distance'>): string =>
  [
    w.duration ? `${w.duration} min` : null,
    w.kcal ? `${w.kcal} kcal` : null,
    w.distance ? `${w.distance} km` : null,
  ]
    .filter(Boolean)
    .join(' · ')
