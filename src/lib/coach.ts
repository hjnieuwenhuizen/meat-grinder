// The macro calculator and energy-zone engine. Pure functions, no Firestore.
//
// Science, briefly:
// - BMR via Mifflin-St Jeor (the best-validated everyday formula).
// - Rest-day TDEE = BMR × a lifestyle factor that deliberately EXCLUDES
//   training — workouts are logged explicitly, so they must not be
//   double-counted in the baseline.
// - 1 kg of body fat ≈ 7 700 kcal, so a target rate in kg/week maps to a
//   daily calorie offset of rate × 7700 / 7 = rate × 1100.
// - Protein is set per-kg by diet style; fat keeps a practical floor of
//   ~0.7 g/kg (a coaching guardrail, not a proven hormonal threshold);
//   carbs take whatever energy remains.
import type { ActivityId, DietId, DayDoc, GoalSnapshot, Macros, Profile, Workout } from '../types'

export const KCAL_PER_KG = 7700

export const ACTIVITIES: { id: ActivityId; label: string; blurb: string; factor: number }[] = [
  { id: 'sedentary', label: 'Desk-bound', blurb: 'Sitting most of the day, little walking', factor: 1.2 },
  { id: 'light', label: 'Lightly active', blurb: 'Some walking, on your feet a few hours', factor: 1.35 },
  { id: 'moderate', label: 'On the move', blurb: 'On your feet most of the day', factor: 1.5 },
  { id: 'active', label: 'Physical job', blurb: 'Manual work, constantly moving', factor: 1.65 },
  { id: 'athlete', label: 'Very physical', blurb: 'Heavy labour or multiple daily sessions', factor: 1.8 },
]

export const DIETS: { id: DietId; label: string; icon: string; blurb: string; proteinPerKg: number; carbs: 'none' | 'trace' | number }[] = [
  { id: 'carnivore', label: 'Carnivore', icon: '🥩', blurb: 'Meat, eggs, animal fats. Carbs ~0.', proteinPerKg: 2.2, carbs: 'none' },
  { id: 'keto', label: 'Keto', icon: '🥑', blurb: 'Under ~25g carbs, fat for fuel.', proteinPerKg: 2.0, carbs: 'trace' },
  { id: 'lowcarb', label: 'Low carb', icon: '🍳', blurb: 'Carbs kept to ~20% of calories.', proteinPerKg: 2.0, carbs: 0.2 },
  { id: 'balanced', label: 'Balanced', icon: '🍽️', blurb: 'Classic split, nothing excluded.', proteinPerKg: 1.8, carbs: 0.45 },
  { id: 'highcarb', label: 'Performance', icon: '🍚', blurb: 'Carb-forward for hard training.', proteinPerKg: 1.8, carbs: 0.55 },
]

export const GOAL_RATES: { rate: number; label: string; blurb: string }[] = [
  { rate: -1, label: 'Aggressive cut', blurb: '−1 kg/week · demanding, short stints only' },
  { rate: -0.75, label: 'Strong cut', blurb: '−0.75 kg/week' },
  { rate: -0.5, label: 'Steady cut', blurb: '−0.5 kg/week · the sustainable classic' },
  { rate: -0.25, label: 'Slow cut', blurb: '−0.25 kg/week · barely feels like dieting' },
  { rate: 0, label: 'Maintain', blurb: 'Hold weight, recomp slowly' },
  { rate: 0.25, label: 'Lean gain', blurb: '+0.25 kg/week · minimal fat' },
  { rate: 0.5, label: 'Bulk', blurb: '+0.5 kg/week · faster muscle, some fat' },
]

export const ageOf = (p: Pick<Profile, 'birthYear'>): number =>
  Math.max(14, new Date().getFullYear() - p.birthYear)

/** Mifflin-St Jeor basal metabolic rate */
export const bmr = (p: Profile): number =>
  10 * p.weightKg + 6.25 * p.heightCm - 5 * ageOf(p) + (p.sex === 'male' ? 5 : -161)

/** calories burned on a day with NO logged training */
export const restTdee = (p: Profile): number =>
  bmr(p) * (ACTIVITIES.find((a) => a.id === p.activity)?.factor ?? 1.35)

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5)
const round10 = (n: number) => Math.max(0, Math.round(n / 10) * 10)

// protein is its own dial — requirement and carb preference are separate
// concepts (a high-carb cutter can want 2.2 g/kg too)
export const PROTEIN_CHOICES = [1.6, 1.8, 2.0, 2.2]
export const recommendedProtein = (goalRate: number): number =>
  goalRate < 0 ? 2.2 : goalRate > 0 ? 1.8 : 2.0

const proteinPerKgOf = (p: Profile): number =>
  p.proteinPerKg ?? DIETS.find((d) => d.id === p.diet)?.proteinPerKg ?? 1.8

/** Protein / fat-floor reference weight. At high BMI, per-kg-of-actual-weight
 *  prescribes absurd targets (2.2 g/kg × 127 kg = 280 g protein). Standard
 *  clinical fix: adjusted bodyweight = ideal (BMI 25) + 40% of the excess,
 *  applied once BMI passes ~30. Calorie burn (BMR) still uses actual weight. */
export const refWeightKg = (p: Pick<Profile, 'weightKg' | 'heightCm'>): number => {
  const ideal = 25 * (p.heightCm / 100) ** 2
  return p.weightKg > ideal * 1.2 ? Math.round(ideal + 0.4 * (p.weightKg - ideal)) : p.weightKg
}

const macrosFor = (p: Profile, kcal: number, extraCarbsKcal = 0): Macros => {
  const diet = DIETS.find((d) => d.id === p.diet) ?? DIETS[3]
  const protein = refWeightKg(p) * proteinPerKgOf(p)
  const proteinKcal = protein * 4

  let carbsG: number
  if (diet.carbs === 'none') carbsG = 5
  else if (diet.carbs === 'trace') carbsG = 25
  else carbsG = ((kcal - extraCarbsKcal) * diet.carbs + extraCarbsKcal) / 4

  let fatG = (kcal - proteinKcal - carbsG * 4) / 9
  const fatFloor = refWeightKg(p) * 0.7
  if (fatG < fatFloor && typeof diet.carbs === 'number') {
    // protect the fat floor by taking energy back from carbs
    fatG = fatFloor
    carbsG = Math.max(0, (kcal - proteinKcal - fatG * 9) / 4)
  }

  return { kcal: round10(kcal), protein: round5(protein), carbs: round5(carbsG), fat: round5(fatG) }
}

/** guardrails, per coaching review:
 *  - preset paces prescribe at most a 20% deficit of rest TDEE — the
 *    evidence-preferred starting point for keeping muscle; 25% stays as
 *    the HARD cap, reachable only via an explicit custom kcal target
 *    (BMR is an ESTIMATE of resting burn, not a safety threshold —
 *    it's advisory only)
 *  - rate is expressed as % bodyweight/week (muscle-safe band ~0.4–0.7%)
 *  - when a cap bites, the honest rate is recomputed from the ACTUAL
 *    deficit, never the requested one */
export const MAX_DEFICIT_PCT = 0.25
export const TARGET_DEFICIT_PCT = 0.2
const deficitCapOf = (p: Profile): number => (p.customTarget ? MAX_DEFICIT_PCT : TARGET_DEFICIT_PCT)

export const planCheck = (p: Profile) => {
  const tdee = restTdee(p)
  const raw = tdee + (p.goalRate * KCAL_PER_KG) / 7
  const capPct = deficitCapOf(p)
  const floorKcal = tdee * (1 - capPct)
  const target = Math.max(raw, floorKcal)
  const actualRate = Math.round(((target - tdee) * 7 / KCAL_PER_KG) * 100) / 100
  const ratePctBw = Math.round((Math.abs(p.goalRate) / p.weightKg) * 1000) / 10
  return {
    tdee: Math.round(tdee),
    targetKcal: Math.round(target),
    capped: raw < floorKcal - 1,
    /** the truthful pace after any cap — display THIS, not the requested rate */
    actualRate,
    belowBmr: target < bmr(p),
    ratePctBw,
    tooFast: p.goalRate < 0 && ratePctBw > 0.85,
    deficitPctTdee: p.goalRate < 0 ? Math.round(((tdee - target) / tdee) * 100) : 0,
    capPct: Math.round(capPct * 100),
  }
}

/** the full plan the wizard writes into Settings */
export const buildPlan = (p: Profile): GoalSnapshot => {
  // presets cap the deficit at 20% of rest TDEE; explicit custom targets may go to 25%
  const restKcal = Math.max(restTdee(p) * (1 - deficitCapOf(p)), restTdee(p) + (p.goalRate * KCAL_PER_KG) / 7)
  // training days earn a modest bump; carb-tolerant diets put it in carbs,
  // keto/carnivore put it in fat
  const bump = 300
  const rest = macrosFor(p, restKcal)
  const carbDiet = !['carnivore', 'keto'].includes(p.diet)
  const training = carbDiet
    ? macrosFor(p, restKcal + bump, bump)
    : { ...rest, kcal: round10(restKcal + bump), fat: round5(rest.fat + bump / 9) }

  return {
    trainingEnabled: (p.trainingDays ?? 0) > 0,
    rest,
    training,
  }
}

/* ---------- energy zones: where today's eating actually lands ---------- */

export interface EnergyZone {
  id: 'extreme' | 'aggressive' | 'moderate' | 'mild' | 'maintenance' | 'surplus'
  label: string
  color: string
}

export const ZONES: EnergyZone[] = [
  { id: 'extreme', label: 'Extreme cut', color: 'var(--color-over)' },
  { id: 'aggressive', label: 'Aggressive cut', color: 'var(--color-fat)' },
  { id: 'moderate', label: 'Moderate cut', color: 'var(--color-grind)' },
  { id: 'mild', label: 'Mild cut', color: 'var(--color-grind)' },
  { id: 'maintenance', label: 'Maintenance', color: 'var(--color-carbs)' },
  { id: 'surplus', label: 'Gaining', color: 'var(--color-fat)' },
]

/** today's actual burn: rest TDEE + every logged workout's calories.
 *  Insight only — the budget/goal NEVER eats this back. */
export const maintenanceToday = (p: Profile, day: Pick<DayDoc, 'workouts'> | null | undefined): number =>
  restTdee(p) + (day?.workouts ?? []).reduce((s, w) => s + (w.kcal ?? 0), 0)

export const zoneFor = (delta: number): EnergyZone => {
  if (delta <= -1000) return ZONES[0]
  if (delta <= -600) return ZONES[1]
  if (delta <= -300) return ZONES[2]
  if (delta <= -100) return ZONES[3]
  if (delta <= 150) return ZONES[4]
  return ZONES[5]
}

/** kcal/day delta → estimated kg/week */
export const kgPerWeek = (delta: number): number =>
  Math.round(((delta * 7) / KCAL_PER_KG) * 100) / 100

export interface EnergyReadout {
  maintenance: number
  /** exercise burn used in the math — physics estimate for runs */
  exerciseKcal: number
  /** what the wearable claimed, for honest side-by-side display */
  watchKcal: number
  eaten: number
  delta: number
  zone: EnergyZone
  kgWeek: number
}

/** the four hero-bar bands, anchored to today's maintenance M:
 *  extreme loss < M−1000 ≤ weight loss < M−250 ≤ maintenance ≤ M+150 < gaining */
export const heroBands = (maintenance: number) => [
  { id: 'extreme', label: 'extreme', to: maintenance - 1000, color: 'var(--color-over)' },
  { id: 'loss', label: 'weight loss', to: maintenance - 250, color: 'var(--color-grind)' },
  { id: 'maintain', label: 'maintain', to: maintenance + 150, color: 'var(--color-carbs)' },
  { id: 'gain', label: 'gain', to: Number.POSITIVE_INFINITY, color: 'var(--color-fat)' },
] as const

export const energyReadout = (
  p: Profile,
  day: Pick<DayDoc, 'workouts'> | null | undefined,
  eatenKcal: number,
): EnergyReadout => {
  // same estimator the fuel layer uses — one number, no double standards
  const exerciseKcal = Math.round((day?.workouts ?? []).reduce((s, w) => s + workoutBurn(w, p.weightKg), 0))
  const watchKcal = Math.round((day?.workouts ?? []).reduce((s, w) => s + (w.kcal ?? 0), 0))
  const maintenance = Math.round(restTdee(p) + exerciseKcal)
  const delta = Math.round(eatenKcal - maintenance)
  return { maintenance, exerciseKcal, watchKcal, eaten: Math.round(eatenKcal), delta, zone: zoneFor(delta), kgWeek: kgPerWeek(delta) }
}

/** Calorie compliance. In the band (90–110%) is always green. When CUTTING,
 *  any deeper deficit that stays above the extreme line (burn − 1000) is
 *  green too — undershooting a cut only fails once it becomes under-fueling.
 *  Maintaining/bulking keep the symmetric band: under there = missed plan. */
export const kcalInRange = (
  goalKcal: number,
  eatenKcal: number,
  p: Profile | null | undefined,
  day: Pick<DayDoc, 'workouts'> | null | undefined,
): boolean => {
  if (goalKcal <= 0) return false
  const r = eatenKcal / goalKcal
  if (r >= 0.9 && r <= 1.1) return true
  if (r < 0.9 && p && p.goalRate < 0) {
    return eatenKcal >= energyReadout(p, day, eatenKcal).maintenance - 1000
  }
  return false
}

/* ---------- endurance fueling layer ----------
 * A fixed training-day goal is fine for a gym session; it is nonsense for an
 * 18 km run. When a day's LOGGED exercise burn is large, the goal itself
 * earns a fuel bonus: 60% of the burn above 400 kcal, capped at +1000,
 * given as carbohydrate. Deliberately partial — we never credit burn 1:1.
 * Runs use a transparent physics estimate (≈1 kcal per kg per km) instead
 * of wearable calories, which routinely run 15–20% hot. */
export const FUEL_THRESHOLD = 400
export const FUEL_FRACTION = 0.6
export const FUEL_CAP = 1000
export const RUN_KCAL_PER_KG_KM = 1

const workoutBurn = (w: Pick<Workout, 'type' | 'kcal' | 'distance'>, weightKg?: number): number =>
  w.type === 'run' && weightKg && w.distance
    ? RUN_KCAL_PER_KG_KM * weightKg * w.distance
    : w.kcal ?? 0

export const fuelBonusKcal = (day: Pick<DayDoc, 'workouts'> | null | undefined, weightKg?: number): number => {
  const ex = (day?.workouts ?? []).reduce((s, w) => s + workoutBurn(w, weightKg), 0)
  return Math.min(FUEL_CAP, Math.max(0, Math.round((FUEL_FRACTION * (ex - FUEL_THRESHOLD)) / 10) * 10))
}

/** goal + endurance fuel (carbs). Enabled only when a profile exists. */
export const applyFuel = (
  goal: Macros,
  day: Pick<DayDoc, 'workouts'> | null | undefined,
  profile: Profile | null | undefined,
): { goal: Macros; fuel: number } => {
  if (!profile) return { goal, fuel: 0 }
  const fuel = fuelBonusKcal(day, profile.weightKg)
  if (!fuel) return { goal, fuel: 0 }
  return {
    goal: { ...goal, kcal: goal.kcal + fuel, carbs: goal.carbs + Math.round(fuel / 4 / 5) * 5 },
    fuel,
  }
}
