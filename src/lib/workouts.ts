import type { Workout, WorkoutTypeId } from '../types'

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

export const workoutType = (id: WorkoutTypeId) =>
  WORKOUT_TYPES.find((t) => t.id === id) ?? FALLBACK

export const workoutTitle = (w: Pick<Workout, 'type' | 'name'>): string => {
  // Garmin's own activity name is the most specific label we have
  if (w.name?.trim()) return w.name.trim()
  const t = workoutType(w.type)
  return DAY_TYPES.includes(t.id) ? `${t.label} day` : t.label
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
