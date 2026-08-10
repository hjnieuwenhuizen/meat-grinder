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

export type DietId = 'carnivore' | 'keto' | 'lowcarb' | 'balanced' | 'highcarb'
export type ActivityId = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete'

/** who the user is — drives the macro calculator and energy zones */
export interface Profile {
  sex: 'male' | 'female'
  birthYear: number
  heightCm: number
  weightKg: number
  /** baseline lifestyle WITHOUT logged training (job, day-to-day movement) */
  activity: ActivityId
  diet: DietId
  /** target rate in kg per week: negative = lose, 0 = maintain, positive = gain */
  goalRate: number
  trainingDays?: number
  /** protein target in g/kg — independent of diet style */
  proteinPerKg?: number
}

export interface Settings {
  trainingEnabled: boolean
  rest: Macros
  training: Macros
  profile?: Profile
}

/** frozen copy of the goals as they were when the day was logged —
 *  later Settings changes never rewrite history */
export interface GoalSnapshot {
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
  /* --- Garmin metrics (present when the watch provides them) --- */
  avgHr?: number | null
  maxHr?: number | null
  /** minutes per km (runs/walks/hikes) */
  paceMinKm?: number | null
  /** km/h (rides) */
  speedKmh?: number | null
  /** elevation gain in metres */
  elevM?: number | null
  /** running cadence, steps per minute */
  cadence?: number | null
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
  /** manually TYPED steps — wins over every automatic source */
  steps?: number | null
  garmin?: GarminDay
  /** phone sensors via Health Connect (Android shell) — separate lane so a
   *  pocketed phone can never bury a watch's count */
  health?: { steps?: number | null }
  /** goals frozen at log time — see GoalSnapshot */
  goals?: GoalSnapshot
  /** morning weigh-in — weight required, composition optional */
  body?: BodyLog
}

export interface BodyLog {
  weightKg: number
  bodyFatPct?: number | null
  muscleKg?: number | null
}

/* --- family leaderboard --- */

export interface FamilyMember {
  name: string
  /** tiny data-URL avatar, or Google photoURL */
  photo?: string | null
  joinedAt: number
}

export interface FamilyDoc {
  name: string
  members: Record<string, FamilyMember>
  createdAt: number
}

/** which daily points were earned (values are points, 0 = missed) */
export interface ScoreBreakdown {
  logged: number
  protein: number
  kcal: number
  workout: number
  steps: number
  sleep: number
  dry: number
  perfect: number
}

/** published daily score summary — never the diary itself */
export interface ScoreDoc {
  uid: string
  date: string
  points: number
  steps: number
  /** workout distance that day (km) — absent on old docs */
  km?: number
  breakdown: ScoreBreakdown
  updatedAt: number
}

export type ChallengeMetric =
  | 'steps' | 'points' | 'km'
  | 'workoutDays' | 'proteinDays' | 'greenDays' | 'dryDays'

/** long-range competition, e.g. "most steps Sep–Dec" — whole family competes */
export interface ChallengeDoc {
  id: string
  name: string
  metric: ChallengeMetric
  /** yyyy-mm-dd, inclusive */
  start: string
  end: string
  createdBy: string
  createdAt: number
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
