export const WORKOUT_TYPES = [
  { id: 'push', label: 'Push', icon: '🏋️' },
  { id: 'legs', label: 'Legs', icon: '🏋️' },
  { id: 'pull', label: 'Pull', icon: '🏋️' },
  { id: 'run', label: 'Run', icon: '🏃' },
  { id: 'other', label: 'Other', icon: '⚡' },
]

export const workoutType = (id) =>
  WORKOUT_TYPES.find((t) => t.id === id) ?? WORKOUT_TYPES[4]

export const workoutTitle = (w) => {
  const t = workoutType(w.type)
  return t.id === 'run' || t.id === 'other' ? t.label : `${t.label} day`
}

// "45 min · 320 kcal · 5.2 km"
export const workoutDetails = (w) =>
  [
    w.duration ? `${w.duration} min` : null,
    w.kcal ? `${w.kcal} kcal` : null,
    w.distance ? `${w.distance} km` : null,
  ]
    .filter(Boolean)
    .join(' · ')
