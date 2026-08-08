export const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'snack1', label: 'Morning snack' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'snack2', label: 'Afternoon snack' },
  { id: 'supper', label: 'Supper' },
  { id: 'snack3', label: 'Evening snack' },
]

export const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label ?? 'Unsorted'

// sensible default slot based on the clock
export const defaultMealNow = () => {
  const h = new Date().getHours() + new Date().getMinutes() / 60
  if (h < 10.5) return 'breakfast'
  if (h < 12) return 'snack1'
  if (h < 14.5) return 'lunch'
  if (h < 17) return 'snack2'
  if (h < 20.5) return 'supper'
  return 'snack3'
}
