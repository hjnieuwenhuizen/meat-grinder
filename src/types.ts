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
  /** goal came from a typed kcal target — allowed up to the 25% hard cap */
  customTarget?: boolean
}

export interface Settings {
  trainingEnabled: boolean
  rest: Macros
  training: Macros
  profile?: Profile
  // user opted out of the wizard plan — goals are hand-typed (profile kept for energy zones/fueling)
  manualGoals?: boolean
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

/** shared exercise library — one doc per movement, frecency-ranked */
export interface Exercise {
  id: string
  name: string
  /** alternative names that resolve to this movement (e.g. "Pec Deck" → "Pec Fly") */
  aliases?: string[]
  used?: number
  lastUsed?: number
}

export type SetType = 'warmup' | 'working' | 'drop' | 'backoff'
export type LoadType = 'external' | 'bodyweight' | 'assistance'
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other'
export type GroupType = 'superset' | 'tri-set' | 'giant-set' | 'circuit'

/** one set logged live in the gym. Volume semantics (setsVolume):
 *  warm-ups count 0; loadType bodyweight/assistance counts 0 external
 *  (assistanceKg is help, not load); loadPerHand doubles weightKg. */
export interface WorkoutSet {
  id: string
  exercise: string
  weightKg?: number | null
  reps?: number | null
  /** warm-up sets are excluded from working volume (legacy flag; see setType) */
  warmup?: boolean | null
  /** taken to muscular failure */
  toFailure?: boolean | null
  /** warmup | working | drop | backoff — supersedes the warmup flag */
  setType?: SetType | null
  /** the set this drop/backoff extends */
  parentSetId?: string | null
  /** external (default) | bodyweight | assistance */
  loadType?: LoadType | null
  /** machine assistance in kg — less assistance = stronger; never counted as volume */
  assistanceKg?: number | null
  equipment?: Equipment | null
  /** weightKg is per hand (dumbbells) — external load per rep is 2× */
  loadPerHand?: boolean | null
  /** superset/circuit membership */
  groupId?: string | null
  groupType?: GroupType | null
  round?: number | null
  /** reps-in-reserve / rate of perceived exertion */
  rir?: number | null
  rpe?: number | null
  /** e.g. "3-1-1-1" or "slow" */
  tempo?: string | null
  note?: string | null
}

export interface Workout {
  id: string
  type: WorkoutTypeId
  /** sets captured live in the gym — the Garmin activity merges onto this card later */
  sets?: WorkoutSet[]
  /** when live logging began — lets the Garmin sync time-match its activity */
  startedAt?: number | null
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

/** daily wellness pulled from Garmin — every field optional/additive */
export interface GarminDay {
  steps?: number | null
  restingHr?: number | null
  /** sleep quality 0–100 */
  sleepScore?: number | null
  /** avg overnight HRV, ms */
  hrv?: number | null
  hrvStatus?: string | null
  /** avg stress 0–100 */
  stress?: number | null
  stressMax?: number | null
  bodyBattery?: number | null
  bodyBatteryHigh?: number | null
  bodyBatteryLow?: number | null
  /** training readiness 0–100 — Garmin's suggested-rest signal */
  readiness?: number | null
  readinessLevel?: string | null
  /** moderate + 2×vigorous minutes */
  intensityMin?: number | null
  floors?: number | null
  /** avg overnight breaths/min */
  respiration?: number | null
  spo2?: number | null
  activeKcal?: number | null
}

export interface DayDoc {
  training: boolean
  entries: Entry[]
  workouts: Workout[]
  sleep?: number | null
  /** legacy manually typed steps — fallback only; Garmin > Health Connect > this */
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

/* --- recipes --- */

/** macros are for the STATED qty — scaling an ingredient scales its macros */
export interface RecipeIngredient {
  id: string
  name: string
  qty: number
  unit: string
  kcal?: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  optional?: boolean
}

export interface RecipeSection {
  id: string
  title: string
  ingredients: RecipeIngredient[]
  method: string
}

export interface Recipe {
  id: string
  name: string
  emoji?: string | null
  portions: number
  sections: RecipeSection[]
  notes?: string | null
  createdAt: number
  updatedAt: number
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
