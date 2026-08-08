// Core data model — see AGENTS.md for the product rules behind these shapes.

export type Unit = 'g' | 'ml' | 'scoop' | 'unit'
export type MealId = 'breakfast' | 'snack1' | 'lunch' | 'snack2' | 'supper' | 'snack3'
export type WorkoutTypeId =
  | 'push' | 'legs' | 'pull' | 'strength'
  | 'run' | 'walk' | 'ride' | 'swim' | 'hike' | 'stairs' | 'cardio'
  | 'other'

export interface Macros {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export interface Settings {
  trainingEnabled: boolean
  rest: Macros
  training: Macros
}

/** Library food: macros per 100 g/ml, or per 1 scoop/unit. */
export interface Food extends Macros {
  id: string
  name: string
  unit?: Unit
  /** default portion in g/ml (per-100 foods only) */
  serving?: number | null
  alcohol?: boolean
  /** grams of pure alcohol per basis */
  alcoholG?: number | null
  /** frecency inputs */
  used?: number
  lastUsed?: number
}

/** Diary entry: macros are baked in at log time (denormalized). */
export interface Entry extends Macros {
  id: string
  name: string
  /** amount in `unit`; legacy entries used `grams` instead */
  amount?: number | null
  unit?: Unit | null
  grams?: number | null
  meal?: MealId | null
  alcohol?: boolean
  alcoholG?: number | null
}

export interface Workout {
  id: string
  type: WorkoutTypeId
  /** Garmin activity name, e.g. "Stair Stepper" — shown as the title when present */
  name?: string | null
  duration?: number | null
  kcal?: number | null
  distance?: number | null
  when?: 'before' | 'after'
  meal?: MealId | null
  /** set by the Garmin sync for dedupe */
  garminId?: number
}

/** daily wellness pulled from Garmin */
export interface GarminDay {
  steps?: number | null
  restingHr?: number | null
}

export interface DayDoc {
  training: boolean
  entries: Entry[]
  workouts: Workout[]
  sleep?: number | null
  garmin?: GarminDay
}

export interface McpConfig {
  key: string
  createdAt?: number
}

export interface GarminStatus {
  connected: boolean
  /** credentials saved, waiting for Garmin to stop rate-limiting our IP */
  pending?: boolean
  connectedAt?: number
  lastSync?: number
  lastResult?: string
  lastError?: string | null
}
