// LLM integrations — two doors into the same read-only data:
//  1. MCP server (Streamable HTTP) for Claude / ChatGPT connectors: /mcp/<key>
//  2. REST + OpenAPI for custom GPT "Actions": /api/* with X-API-Key header
// Both authenticate with the personal key generated in Settings
// (users/{uid}/meta/mcp, indexed server-side in `mcpKeys`).
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
// lazy circular import is safe under CJS: only called inside request handlers
import { syncIfStale } from './index.js'

if (!getApps().length) initializeApp()
const db = getFirestore()

const REGION = 'europe-west1'
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/

interface Macros {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

interface Entry extends Macros {
  name: string
  amount?: number | null
  unit?: string | null
  grams?: number | null
  meal?: string | null
  alcohol?: boolean
  alcoholG?: number | null
}

interface Workout {
  type: string
  name?: string | null
  duration?: number | null
  kcal?: number | null
  distance?: number | null
  meal?: string | null
  when?: string
}

interface DayDoc {
  training: boolean
  entries: Entry[]
  workouts: Workout[]
  sleep?: number | null
  /** manually typed steps — wins over automatic sources */
  steps?: number | null
  garmin?: { steps?: number | null; restingHr?: number | null }
  /** phone Health Connect steps */
  health?: { steps?: number | null }
  /** goals frozen when the day was first written — later Settings edits never rewrite history */
  goals?: { trainingEnabled: boolean; rest: Macros; training: Macros }
  /** morning weigh-in */
  body?: { weightKg: number; bodyFatPct?: number | null; muscleKg?: number | null }
}

const totalsOf = (entries: Entry[]): Macros =>
  entries.reduce(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      protein: t.protein + e.protein,
      carbs: t.carbs + e.carbs,
      fat: t.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

const round = (m: Macros): Macros => ({
  kcal: Math.round(m.kcal),
  protein: Math.round(m.protein * 10) / 10,
  carbs: Math.round(m.carbs * 10) / 10,
  fat: Math.round(m.fat * 10) / 10,
})

/* ---------- shared payload builders (used by MCP tools AND the REST api) ---------- */

const loadDay = async (uid: string, date: string): Promise<DayDoc> => {
  const snap = await db.doc(`users/${uid}/days/${date}`).get()
  return { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc> | undefined) }
}

const loadSettings = async (uid: string) =>
  (await db.doc(`users/${uid}/meta/settings`).get()).data() ?? {
    trainingEnabled: false,
    rest: { kcal: 2200, protein: 180, carbs: 200, fat: 70 },
  }

// the day's frozen snapshot wins; live settings only cover legacy days
const resolveGoal = (day: DayDoc, settings: Record<string, unknown>): Macros | null => {
  const src = (day.goals ?? settings) as { trainingEnabled?: boolean; rest?: Macros; training?: Macros }
  const g = src.trainingEnabled && day.training ? src.training : src.rest
  return g ?? null
}

// freeze current goals onto a day the first time the server writes it
const stampGoals = (day: DayDoc, settings: Record<string, unknown>) => {
  const rest = settings.rest as Macros | undefined
  if (!day.goals && rest) {
    day.goals = {
      trainingEnabled: Boolean(settings.trainingEnabled),
      rest,
      training: (settings.training as Macros | undefined) ?? rest,
    }
  }
}

const ACTIVITY_FACTORS: Record<string, number> = { sedentary: 1.2, light: 1.35, moderate: 1.5, active: 1.65, athlete: 1.8 }

// where today's eating lands vs today's actual burn (insight only — the
// budget never eats back exercise calories)
const energyOf = (settings: Record<string, unknown>, day: DayDoc, eatenKcal: number) => {
  const p = settings.profile as
    | { sex: string; birthYear: number; heightCm: number; weightKg: number; activity: string }
    | undefined
  if (!p) return null
  const age = Math.max(14, new Date().getFullYear() - p.birthYear)
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age + (p.sex === 'male' ? 5 : -161)
  const exerciseKcal = (day.workouts ?? []).reduce((s, w) => s + (w.kcal ?? 0), 0)
  const maintenance = Math.round(bmr * (ACTIVITY_FACTORS[p.activity] ?? 1.35) + exerciseKcal)
  const delta = Math.round(eatenKcal - maintenance)
  const zone =
    delta <= -1000 ? 'extreme cut' :
    delta <= -600 ? 'aggressive cut' :
    delta <= -300 ? 'moderate cut' :
    delta <= -100 ? 'mild cut' :
    delta <= 150 ? 'maintenance' : 'surplus (gaining)'
  return {
    maintenanceKcalToday: maintenance,
    exerciseKcal,
    deltaVsBurn: delta,
    zone,
    estKgPerWeek: Math.round(((delta * 7) / 7700) * 100) / 100,
  }
}

// endurance fueling: 60% of estimated burn above 400 kcal (cap 1000) added to
// the goal as carbs — partial on purpose. Runs use ≈1 kcal/kg/km instead of
// wearable calories (which run hot). MUST mirror applyFuel in src/lib/coach.ts.
const fuelOf = (day: DayDoc, settings: Record<string, unknown>): number => {
  const p = settings.profile as { weightKg?: number } | undefined
  if (!p) return 0
  const ex = (day.workouts ?? []).reduce(
    (s, w) => s + (w.type === 'run' && p.weightKg && w.distance ? p.weightKg * w.distance : w.kcal ?? 0),
    0,
  )
  return Math.min(1000, Math.max(0, Math.round((0.6 * (ex - 400)) / 10) * 10))
}

const fueledGoal = (day: DayDoc, settings: Record<string, unknown>): { goal: Macros | null; fuel: number } => {
  const base = resolveGoal(day, settings)
  const fuel = fuelOf(day, settings)
  if (!base || !fuel) return { goal: base, fuel: 0 }
  return { goal: { ...base, kcal: base.kcal + fuel, carbs: base.carbs + Math.round(fuel / 4 / 5) * 5 }, fuel }
}

const daySummary = (date: string, day: DayDoc, settings: Record<string, unknown>) => {
  const totals = round(totalsOf(day.entries))
  const { goal, fuel } = fueledGoal(day, settings)
  const alcohol = day.entries.filter((e) => e.alcohol)
  return {
    date,
    trainingDay: day.training,
    goal,
    enduranceFuelKcal: fuel || null,
    energy: energyOf(settings, day, totals.kcal),
    totals,
    sleepHours: day.sleep ?? null,
    body: day.body ?? null,
    steps: day.steps ?? day.garmin?.steps ?? day.health?.steps ?? null,
    restingHeartRate: day.garmin?.restingHr ?? null,
    alcohol: alcohol.length
      ? {
          kcal: Math.round(alcohol.reduce((s, e) => s + e.kcal, 0)),
          pureAlcoholGrams: Math.round(alcohol.reduce((s, e) => s + (e.alcoholG || 0), 0)),
        }
      : null,
    workouts: day.workouts.map((w) => ({
      type: w.type,
      name: w.name ?? null,
      minutes: w.duration ?? null,
      kcalBurned: w.kcal ?? null,
      distanceKm: w.distance ?? null,
      avgHeartRate: (w as { avgHr?: number | null }).avgHr ?? null,
      maxHeartRate: (w as { maxHr?: number | null }).maxHr ?? null,
      paceMinPerKm: (w as { paceMinKm?: number | null }).paceMinKm ?? null,
      speedKmh: (w as { speedKmh?: number | null }).speedKmh ?? null,
      elevationGainM: (w as { elevM?: number | null }).elevM ?? null,
      runCadenceSpm: (w as { cadence?: number | null }).cadence ?? null,
      slot: w.meal ?? null,
      when: w.when ?? null,
    })),
  }
}

const goalsPayload = (uid: string) => loadSettings(uid)

const dayPayload = async (uid: string, date: string) => {
  const [day, settings] = await Promise.all([loadDay(uid, date), loadSettings(uid)])
  return {
    ...daySummary(date, day, settings),
    entries: day.entries.map((e) => ({
      id: (e as { id?: string }).id ?? null,
      name: e.name,
      amount: e.amount ?? e.grams ?? null,
      unit: e.unit ?? (e.grams != null ? 'g' : null),
      mealSlot: e.meal ?? null,
      alcohol: e.alcohol ?? false,
      ...round(e),
    })),
  }
}

const rangePayload = async (uid: string, start: string, end: string) => {
  const snap = await db
    .collection(`users/${uid}/days`)
    .orderBy('__name__')
    .startAt(start)
    .endAt(end)
    .limit(62)
    .get()
  const settings = await loadSettings(uid)
  const days = snap.docs.map((d) =>
    daySummary(d.id, { training: false, entries: [], workouts: [], ...(d.data() as Partial<DayDoc>) }, settings),
  )
  const logged = days.filter((d) => d.totals.kcal > 0)
  const avg = logged.length
    ? round({
        kcal: logged.reduce((s, d) => s + d.totals.kcal, 0) / logged.length,
        protein: logged.reduce((s, d) => s + d.totals.protein, 0) / logged.length,
        carbs: logged.reduce((s, d) => s + d.totals.carbs, 0) / logged.length,
        fat: logged.reduce((s, d) => s + d.totals.fat, 0) / logged.length,
      })
    : null
  // energy ledger over logged days only — an empty diary is missing data, not a deficit
  const withEnergy = logged.filter((d) => d.energy)
  const totalDelta = withEnergy.reduce((s2, d) => s2 + (d.energy?.deltaVsBurn ?? 0), 0)
  const energyBalance = withEnergy.length
    ? {
        loggedDaysCounted: withEnergy.length,
        totalDeltaKcal: totalDelta,
        impliedWeightChangeKg: Math.round((totalDelta / 7700) * 100) / 100,
        note: 'Estimates. Eaten vs (rest burn + logged exercise) per day; unlogged days excluded, never assumed.',
      }
    : null
  return { days, daysLogged: logged.length, averagesOverLoggedDays: avg, energyBalance }
}

const foodsPayload = async (uid: string, query: string) => {
  const snap = await db.collection(`users/${uid}/foods`).orderBy('name').get()
  const q = query.toLowerCase()
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((f) => String((f as { name?: unknown }).name ?? '').toLowerCase().includes(q))
    .slice(0, 30)
}

/* ---------- food writes (add + edit the library) ---------- */

const UNITS = ['g', 'ml', 'scoop', 'unit']

// whitelist + coerce; `partial` skips fields that weren't provided
const sanitizeFood = (input: Record<string, unknown>, partial = false) => {
  const out: Record<string, unknown> = {}
  const has = (k: string) => input[k] !== undefined
  if (has('name')) out.name = String(input.name).trim().slice(0, 100)
  if (has('unit')) out.unit = UNITS.includes(String(input.unit)) ? String(input.unit) : 'g'
  for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) {
    if (has(k)) out[k] = Math.max(0, Number(input[k]) || 0)
  }
  if (has('serving')) out.serving = Number(input.serving) > 0 ? Number(input.serving) : null
  if (has('alcohol')) out.alcohol = Boolean(input.alcohol)
  if (has('alcoholG')) out.alcoholG = Number(input.alcoholG) > 0 ? Number(input.alcoholG) : null
  if (!partial) {
    if (!out.name) throw new Error('name is required')
    if (out.kcal === undefined) throw new Error('kcal is required')
    out.unit = out.unit ?? 'g'
    out.protein = out.protein ?? 0
    out.carbs = out.carbs ?? 0
    out.fat = out.fat ?? 0
    out.serving = out.serving ?? null
    out.alcohol = out.alcohol ?? false
    out.alcoholG = out.alcoholG ?? null
  }
  return out
}

const foodCreate = async (uid: string, input: Record<string, unknown>) => {
  const food = sanitizeFood(input)
  const ref = db.collection(`users/${uid}/foods`).doc()
  await ref.set(food)
  return { ok: true, id: ref.id, food }
}

const foodUpdate = async (uid: string, id: string, input: Record<string, unknown>) => {
  const ref = db.doc(`users/${uid}/foods/${id}`)
  if (!(await ref.get()).exists) throw new Error(`No food with id ${id}`)
  const changes = sanitizeFood(input, true)
  if (!Object.keys(changes).length) throw new Error('No valid fields to update')
  await ref.update(changes)
  return { ok: true, id, changes }
}

/* ---------- diary write: log a food eaten today (or a given date) ---------- */

const MEAL_IDS = ['breakfast', 'snack1', 'lunch', 'snack2', 'supper', 'snack3']

const slotForNow = (): string => {
  const now = new Date()
  const h = now.getHours() + now.getMinutes() / 60
  if (h < 10.5) return 'breakfast'
  if (h < 12) return 'snack1'
  if (h < 14.5) return 'lunch'
  if (h < 17) return 'snack2'
  if (h < 20.5) return 'supper'
  return 'snack3'
}

const localDateKey = (): string => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface LogFoodInput {
  foodId?: string
  amount?: number
  name?: string
  kcal?: number
  protein?: number
  carbs?: number
  fat?: number
  alcohol?: boolean
  alcoholG?: number
  meal?: string
  date?: string
}

const logFood = async (uid: string, input: LogFoodInput) => {
  const date = input.date && DATE_RX.test(input.date) ? input.date : localDateKey()
  const meal = input.meal && MEAL_IDS.includes(input.meal) ? input.meal : slotForNow()

  let entry: Entry & { id: string; amount: number | null; unit: string | null; meal: string; alcoholG: number | null }

  if (input.foodId) {
    // stored library food: scale macros by amount in the food's own basis
    const snap = await db.doc(`users/${uid}/foods/${input.foodId}`).get()
    if (!snap.exists) throw new Error(`No library food with id ${input.foodId} — use searchFoods first`)
    const food = snap.data() as {
      name: string; unit?: string; serving?: number | null
      kcal: number; protein: number; carbs: number; fat: number
      alcohol?: boolean; alcoholG?: number | null; used?: number
    }
    const per100 = !food.unit || food.unit === 'g' || food.unit === 'ml'
    const amount = input.amount && input.amount > 0 ? input.amount : per100 ? food.serving ?? 100 : 1
    const scale = per100 ? amount / 100 : amount
    entry = {
      id: crypto.randomUUID(),
      name: food.name,
      amount,
      unit: food.unit ?? 'g',
      meal,
      alcohol: Boolean(food.alcohol),
      alcoholG: food.alcohol && food.alcoholG ? Math.round(food.alcoholG * scale * 10) / 10 : null,
      kcal: food.kcal * scale,
      protein: food.protein * scale,
      carbs: food.carbs * scale,
      fat: food.fat * scale,
    }
    await snap.ref.update({ used: (food.used ?? 0) + 1, lastUsed: Date.now() })
  } else {
    // one-off: direct totals for what was actually eaten
    if (!input.name?.trim()) throw new Error('Provide foodId (library) or name + kcal (one-off)')
    if (input.kcal === undefined) throw new Error('kcal is required for a one-off food')
    entry = {
      id: crypto.randomUUID(),
      name: input.name.trim().slice(0, 100),
      amount: input.amount && input.amount > 0 ? input.amount : null,
      unit: input.amount && input.amount > 0 ? 'g' : null,
      meal,
      alcohol: Boolean(input.alcohol),
      alcoholG: input.alcohol && input.alcoholG ? Math.max(0, input.alcoholG) : null,
      kcal: Math.max(0, Number(input.kcal) || 0),
      protein: Math.max(0, Number(input.protein) || 0),
      carbs: Math.max(0, Number(input.carbs) || 0),
      fat: Math.max(0, Number(input.fat) || 0),
    }
  }

  const dayRef = db.doc(`users/${uid}/days/${date}`)
  const daySnap = await dayRef.get()
  const day: DayDoc = { training: false, entries: [], workouts: [], ...(daySnap.data() as Partial<DayDoc>) }
  day.entries = [...day.entries, entry]
  const settings = await loadSettings(uid)
  stampGoals(day, settings as Record<string, unknown>)
  await dayRef.set(day)

  const goal = fueledGoal(day, settings as Record<string, unknown>).goal ?? undefined
  const totals = round(totalsOf(day.entries))

  return {
    ok: true,
    date,
    logged: { ...entry, ...round(entry) },
    totals,
    goal: goal ?? null,
    remaining: goal
      ? round({
          kcal: goal.kcal - totals.kcal,
          protein: goal.protein - totals.protein,
          carbs: goal.carbs - totals.carbs,
          fat: goal.fat - totals.fat,
        })
      : null,
  }
}

/* ---------- diary entry edit + delete ---------- */

const budgetAfter = async (uid: string, day: DayDoc) => {
  const settings = await loadSettings(uid)
  const goal = fueledGoal(day, settings as Record<string, unknown>).goal ?? undefined
  const totals = round(totalsOf(day.entries))
  return {
    totals,
    goal: goal ?? null,
    remaining: goal
      ? round({
          kcal: goal.kcal - totals.kcal,
          protein: goal.protein - totals.protein,
          carbs: goal.carbs - totals.carbs,
          fat: goal.fat - totals.fat,
        })
      : null,
  }
}

interface EntryChanges {
  name?: string
  amount?: number
  kcal?: number
  protein?: number
  carbs?: number
  fat?: number
  meal?: string
  alcohol?: boolean
  alcoholG?: number
}

const entryUpdate = async (uid: string, date: string, entryId: string, changes: EntryChanges) => {
  const dayRef = db.doc(`users/${uid}/days/${date}`)
  const snap = await dayRef.get()
  const day: DayDoc = { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc>) }
  const idx = day.entries.findIndex((e) => (e as { id?: string }).id === entryId)
  if (idx < 0) throw new Error(`No entry ${entryId} on ${date} — check ids via getDay`)

  const e = day.entries[idx] as Entry & { id: string; grams?: number | null }
  const next = { ...e }
  const macroKeys = ['kcal', 'protein', 'carbs', 'fat'] as const
  const hasExplicitMacros = macroKeys.some((k) => changes[k] !== undefined)

  if (changes.name?.trim()) next.name = changes.name.trim().slice(0, 100)
  if (changes.meal && MEAL_IDS.includes(changes.meal)) next.meal = changes.meal

  // amount-only change on a measured entry rescales macros, like the app
  if (changes.amount !== undefined && changes.amount > 0) {
    const a0 = e.amount ?? e.grams
    if (a0 && a0 > 0 && !hasExplicitMacros) {
      const scale = changes.amount / a0
      for (const k of macroKeys) next[k] = (e[k] ?? 0) * scale
      if (e.alcoholG) next.alcoholG = Math.round(e.alcoholG * scale * 10) / 10
    }
    next.amount = changes.amount
    next.grams = null
  }
  for (const k of macroKeys) {
    if (changes[k] !== undefined) next[k] = Math.max(0, Number(changes[k]) || 0)
  }
  if (changes.alcohol !== undefined) next.alcohol = Boolean(changes.alcohol)
  if (changes.alcoholG !== undefined) next.alcoholG = Math.max(0, Number(changes.alcoholG) || 0) || null

  day.entries = day.entries.map((x, i) => (i === idx ? next : x))
  stampGoals(day, await loadSettings(uid))
  await dayRef.set(day)
  return { ok: true, date, entry: { ...next, ...round(next) }, ...(await budgetAfter(uid, day)) }
}

const entryDelete = async (uid: string, date: string, entryId: string) => {
  const dayRef = db.doc(`users/${uid}/days/${date}`)
  const snap = await dayRef.get()
  const day: DayDoc = { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc>) }
  const before = day.entries.length
  const removed = day.entries.find((e) => (e as { id?: string }).id === entryId)
  day.entries = day.entries.filter((e) => (e as { id?: string }).id !== entryId)
  if (day.entries.length === before) throw new Error(`No entry ${entryId} on ${date} — check ids via getDay`)
  stampGoals(day, await loadSettings(uid))
  await dayRef.set(day)
  return { ok: true, date, deleted: removed ? { name: removed.name, ...round(removed) } : null, ...(await budgetAfter(uid, day)) }
}

const logBody = async (
  uid: string,
  date: string,
  input: { weightKg: number; bodyFatPct?: number | null; muscleKg?: number | null },
) => {
  const w = Number(input.weightKg)
  if (!(w >= 30 && w <= 300)) throw new Error('weightKg must be between 30 and 300')
  const body = {
    weightKg: Math.round(w * 10) / 10,
    bodyFatPct: Number(input.bodyFatPct) > 0 && Number(input.bodyFatPct) < 75 ? Math.round(Number(input.bodyFatPct) * 10) / 10 : null,
    muscleKg: Number(input.muscleKg) > 0 && Number(input.muscleKg) < 100 ? Math.round(Number(input.muscleKg) * 10) / 10 : null,
  }
  const dayRef = db.doc(`users/${uid}/days/${date}`)
  const snap = await dayRef.get()
  const day: DayDoc = { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc>) }
  day.body = body
  const settings = await loadSettings(uid)
  stampGoals(day, settings as Record<string, unknown>)
  await dayRef.set(day)
  // keep the calculator honest: latest weigh-in updates the profile weight
  const profile = (settings as { profile?: { weightKg?: number } }).profile
  if (profile && Math.abs((profile.weightKg ?? 0) - body.weightKg) > 0.05) {
    await db.doc(`users/${uid}/meta/settings`).set({ ...settings, profile: { ...profile, weightKg: body.weightKg } })
  }
  return { ok: true, date, body }
}

/* ---------- recipes ---------- */

interface RecipeIngredient {
  id: string; name: string; qty: number; unit: string
  kcal?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null
  optional?: boolean
}
interface RecipeSection { id: string; title: string; ingredients: RecipeIngredient[]; method: string }

const rnum = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null
}

// mirror of src/lib/recipes.ts sanitizeRecipe — keep in sync
const sanitizeRecipe = (input: Record<string, unknown>) => {
  const name = String(input.name ?? '').trim().slice(0, 120)
  if (!name) throw new Error('Recipe needs a name')
  const rawSections = Array.isArray(input.sections) ? input.sections : []
  if (!rawSections.length) throw new Error('Recipe needs at least one section')
  const sections: RecipeSection[] = rawSections.slice(0, 12).map((sec) => {
    const so = sec as Record<string, unknown>
    return {
      id: crypto.randomUUID(),
      title: String(so.title ?? '').trim().slice(0, 120) || 'Recipe',
      method: String(so.method ?? '').trim().slice(0, 8000),
      ingredients: (Array.isArray(so.ingredients) ? so.ingredients : [])
        .slice(0, 60)
        .map((ing) => {
          const io = ing as Record<string, unknown>
          return {
            id: crypto.randomUUID(),
            name: String(io.name ?? '').trim().slice(0, 120),
            qty: Math.max(0, Number(io.qty) || 0),
            unit: String(io.unit ?? '').trim().slice(0, 20) || 'unit',
            kcal: rnum(io.kcal), protein: rnum(io.protein), carbs: rnum(io.carbs), fat: rnum(io.fat),
            ...(io.optional ? { optional: true } : {}),
          }
        })
        .filter((i) => i.name),
    }
  })
  return {
    name,
    emoji: input.emoji ? String(input.emoji).slice(0, 8) : null,
    portions: Math.min(64, Math.max(1, Math.round(Number(input.portions) || 1))),
    sections,
    notes: input.notes ? String(input.notes).slice(0, 2000) : null,
  }
}

const recipeTotals = (sections: RecipeSection[]): Macros =>
  sections.reduce(
    (t, s) => {
      for (const i of s.ingredients) {
        t.kcal += i.kcal ?? 0; t.protein += i.protein ?? 0; t.carbs += i.carbs ?? 0; t.fat += i.fat ?? 0
      }
      return t
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

const recipesPayload = async (uid: string, q: string) => {
  const snap = await db.collection(`users/${uid}/recipes`).orderBy('name').get()
  return snap.docs
    .map((d) => {
      const r = d.data() as { name: string; emoji?: string | null; portions: number; sections: RecipeSection[] }
      const totals = round(recipeTotals(r.sections ?? []))
      return {
        id: d.id,
        name: r.name,
        emoji: r.emoji ?? null,
        portions: r.portions,
        wholeDish: totals,
        perPortion: round({
          kcal: totals.kcal / Math.max(1, r.portions),
          protein: totals.protein / Math.max(1, r.portions),
          carbs: totals.carbs / Math.max(1, r.portions),
          fat: totals.fat / Math.max(1, r.portions),
        }),
        ingredientsMissingMacros: (r.sections ?? []).reduce((n, sct) => n + sct.ingredients.filter((i) => i.kcal == null).length, 0),
      }
    })
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 30)
}

const recipeGet = async (uid: string, id: string) => {
  const snap = await db.doc(`users/${uid}/recipes/${id}`).get()
  if (!snap.exists) throw new Error(`No recipe with id ${id} — use searchRecipes first`)
  return { id: snap.id, ...snap.data() }
}

const recipeCreate = async (uid: string, input: Record<string, unknown>) => {
  const data = sanitizeRecipe(input)
  const ref = db.collection(`users/${uid}/recipes`).doc()
  await ref.set({ ...data, createdAt: Date.now(), updatedAt: Date.now() })
  return { ok: true, id: ref.id, recipe: data }
}

const recipeUpdate = async (uid: string, id: string, input: Record<string, unknown>) => {
  const ref = db.doc(`users/${uid}/recipes/${id}`)
  const snap = await ref.get()
  if (!snap.exists) throw new Error(`No recipe with id ${id}`)
  // full-shape update: the AI sends the complete corrected recipe
  const data = sanitizeRecipe({ ...(snap.data() as Record<string, unknown>), ...input })
  await ref.set({ ...data, createdAt: (snap.data() as { createdAt?: number }).createdAt ?? Date.now(), updatedAt: Date.now() })
  return { ok: true, id, recipe: data }
}

const APP_GUIDE = `# How Meat Grinder works (for AI coaches)

## Philosophy
1. PROTEIN IS MANDATORY: the one hard daily target. Overshooting is a win, never a warning.
2. CALORIES GOVERN THE DAY: judged against a ±10% band of the goal (green 90–110%).
3. CARBS & FAT ARE FLEXIBLE ENERGY LEVERS: only flagged when total calories blow the budget.
4. Exercise is NEVER credited 1:1 (wearable calories overestimate). See "endurance fuel" below.
5. Everything derived from formulas is an ESTIMATE and labelled as such; the real calibrator is the user's weight trend vs the food-math (see /range energyBalance + body data).

## The goal model
- Settings hold rest-day and (optionally) training-day macro goals, plus a profile
  (sex, birthYear, heightCm, weightKg, lifestyle activity EXCLUDING training, diet style,
  proteinPerKg, goalRate kg/week).
- Maintenance = Mifflin-St Jeor BMR × lifestyle factor (1.2–1.8). Training is deliberately
  NOT in the factor — workouts are logged individually, so baselines assume a rest day.
- Deficit guardrails: preset paces prescribe at most a 20% deficit of rest TDEE (the
  evidence-preferred starting point for muscle retention); 25% is the HARD cap, reachable
  only via an explicit custom kcal target. Pace shown as % bodyweight/week (muscle-safe
  cutting band ≈ 0.4–0.7%). When a cap bites, the displayed pace is recomputed from the
  ACTUAL deficit. The equation TDEE is a starting estimate — the weight-trend calibration
  in /range has the final vote.
- GOAL SNAPSHOTS: each day freezes its goals the first time it is written. Later Settings
  changes apply from today forward — historical days, scores and reports never change.
- ENDURANCE FUEL: when a day's estimated workout burn exceeds 400 kcal, that day's goal
  grows by 60% of the excess (capped +1000), added as carbs and labelled. Runs are estimated
  from physics (≈1 kcal × kg × km) instead of wearable calories, which run 15–20% hot; other
  activities fall back to logged kcal. A gym session adds ~0; an 18 km run adds ~670.
  This is the ONLY exercise add-back.
- Energy zones (informational): eaten vs (rest TDEE + logged exercise) → extreme cut /
  aggressive / moderate / mild / maintenance / surplus, with est. kg/week.

## Data semantics
- Diary day = entries[] (food; macros BAKED IN at log time), workouts[], training flag,
  sleep hours, steps, body {weightKg, bodyFatPct?, muscleKg?}, goals snapshot.
- Steps precedence: manually typed > Garmin watch > phone Health Connect.
- Alcohol entries carry alcohol:true and grams of pure alcohol; they count fully in totals.
- Meal slots: breakfast, snack1, lunch, snack2, supper, snack3 (Africa/Johannesburg time).
- Library foods: macros per 100 g/ml, or per 1 scoop/unit. Diary entries store final macros.
- Recipes: sections keep each component's ingredients AND method together. Ingredient macros
  are for the STATED qty (not per 100 g) so scaling one ingredient rescales the dish.
  updateRecipe with sections REPLACES all sections — send the complete corrected list.
- Weigh-ins update profile.weightKg automatically, keeping protein g/kg and zones current.

## How to work (recommended flows)
- Log a known food: searchFoods → logFood {foodId, amount in the food's own basis}.
- Log a one-off: logFood {name, kcal, protein?, carbs?, fat?}.
- Fix an entry: getDay (returns entry ids) → updateEntry (amount-only edits rescale macros)
  or deleteEntry.
- Weigh-in: logBody {weightKg, bodyFatPct?, muscleKg?}.
- Reviews: getRange — check averages, compliance, energyBalance (logged days only,
  unlogged days are missing data, never assumed) and compare implied kg vs actual weight
  trend; if they disagree by >100 kcal/day, recommend retuning maintenance in Settings.
- Every write returns updated totals, goal (incl. endurance fuel) and remaining — coach on it.

## Judging a day fairly
Use the day's OWN goal from getDay (it includes the frozen snapshot + endurance fuel).
Do NOT compare a long-run day against a plain gym-day ceiling, and do not treat an
under-logged day as a real deficit.`

const uidForKey = async (key: string | undefined | null): Promise<string | null> => {
  if (!key || !/^[a-f0-9]{48}$/.test(key)) return null
  const snap = await db.doc(`mcpKeys/${key}`).get()
  return snap.exists ? (snap.data() as { uid: string }).uid : null
}

/* ---------- MCP server ---------- */

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] })

function buildServer(uid: string): McpServer {
  const server = new McpServer({ name: 'meat-grinder', version: '1.0.0' })

  server.registerTool(
    'get_goals',
    { description: "The user's daily macro goals (rest day and, if enabled, training day). Protein is a hard target; carbs/fat are flexible; exercise burn is never added back to the calorie budget." },
    async () => text(await goalsPayload(uid)),
  )

  server.registerTool(
    'get_day',
    {
      description: 'Full diary for one day: every food entry (with id — needed for update_entry/delete_entry — meal slot, amounts, macros, alcohol flags), workouts, sleep, steps, resting heart rate, totals and goals.',
      inputSchema: { date: z.string().regex(DATE_RX).describe('Date as YYYY-MM-DD') },
    },
    async ({ date }) => {
      const garminSync = await syncIfStale(uid)
      return text({ garminSync, ...(await dayPayload(uid, date)) })
    },
  )

  server.registerTool(
    'get_range',
    {
      description: 'Per-day summaries (totals, goals, sleep, steps, resting HR, workouts, alcohol) plus averages over a date range. Use for weekly/monthly reviews and trends. Max 62 days.',
      inputSchema: {
        start_date: z.string().regex(DATE_RX).describe('First day, YYYY-MM-DD'),
        end_date: z.string().regex(DATE_RX).describe('Last day, YYYY-MM-DD (inclusive)'),
      },
    },
    async ({ start_date, end_date }) => {
      const garminSync = await syncIfStale(uid)
      return text({ garminSync, ...(await rangePayload(uid, start_date, end_date)) })
    },
  )

  server.registerTool(
    'search_foods',
    {
      description: "Search the user's personal food/drink library (macros per 100g/ml or per scoop/unit). Returns ids usable with update_food.",
      inputSchema: { query: z.string().describe('Case-insensitive substring of the food name; empty returns everything (max 30)') },
    },
    async ({ query }) => text(await foodsPayload(uid, query)),
  )

  const foodFields = {
    unit: z.enum(['g', 'ml', 'scoop', 'unit']).optional().describe('g/ml → macros per 100; scoop/unit → macros per 1'),
    kcal: z.number().min(0).optional(),
    protein: z.number().min(0).optional().describe('grams'),
    carbs: z.number().min(0).optional().describe('grams'),
    fat: z.number().min(0).optional().describe('grams'),
    serving: z.number().positive().optional().describe('default portion in g/ml (per-100 foods only)'),
    alcohol: z.boolean().optional().describe('alcoholic drinks are shown in red and tracked'),
    alcoholG: z.number().min(0).optional().describe('grams of pure alcohol per basis'),
  }

  server.registerTool(
    'add_food',
    {
      description: "Add a food or drink to the user's library. Macros are per 100 for unit g/ml, per 1 for scoop/unit.",
      inputSchema: { name: z.string().min(1), ...foodFields, kcal: z.number().min(0) },
    },
    async (input) => text(await foodCreate(uid, input as Record<string, unknown>)),
  )

  server.registerTool(
    'log_food',
    {
      description: "Log something the user ate into today's diary (or a given date). Two modes: pass foodId (from search_foods) + amount in the food's own basis (grams/ml for per-100 foods, scoops/units otherwise), OR pass name + kcal (+ protein/carbs/fat) for a one-off. Returns the updated day totals and remaining budget.",
      inputSchema: {
        foodId: z.string().optional().describe('Library food id from search_foods'),
        amount: z.number().positive().optional().describe('Amount in the food basis; defaults to the food serving / 100g / 1 unit'),
        name: z.string().min(1).optional().describe('One-off mode: what was eaten'),
        kcal: z.number().min(0).optional().describe('One-off mode: total calories eaten'),
        protein: z.number().min(0).optional().describe('grams'),
        carbs: z.number().min(0).optional().describe('grams'),
        fat: z.number().min(0).optional().describe('grams'),
        alcohol: z.boolean().optional(),
        alcoholG: z.number().min(0).optional().describe('grams of pure alcohol'),
        meal: z.enum(['breakfast', 'snack1', 'lunch', 'snack2', 'supper', 'snack3']).optional().describe('Meal slot; defaults to the slot matching the current time'),
        date: z.string().regex(DATE_RX).optional().describe('YYYY-MM-DD, defaults to today'),
      },
    },
    async (input) => text(await logFood(uid, input as LogFoodInput)),
  )

  server.registerTool(
    'log_body',
    {
      description: "Log the user's weigh-in for a day: weight (kg) required, body fat %% and skeletal muscle kg optional. Updates the profile weight so future calculations stay honest.",
      inputSchema: {
        weightKg: z.number().min(30).max(300),
        bodyFatPct: z.number().positive().max(75).optional(),
        muscleKg: z.number().positive().max(100).optional(),
        date: z.string().regex(DATE_RX).optional().describe('YYYY-MM-DD, defaults to today'),
      },
    },
    async ({ date, ...input }) =>
      text(await logBody(uid, date && DATE_RX.test(date) ? date : localDateKey(), input)),
  )

  server.registerTool(
    'update_entry',
    {
      description: "Edit a diary entry (get its id from get_day). Changing only `amount` on a measured entry rescales its macros proportionally; explicit macro values override. Returns updated day totals and remaining budget.",
      inputSchema: {
        date: z.string().regex(DATE_RX).describe('Day the entry is on, YYYY-MM-DD'),
        entryId: z.string().min(1),
        name: z.string().min(1).optional(),
        amount: z.number().positive().optional().describe('New amount in the entry unit — rescales macros unless macros are also given'),
        kcal: z.number().min(0).optional(),
        protein: z.number().min(0).optional(),
        carbs: z.number().min(0).optional(),
        fat: z.number().min(0).optional(),
        meal: z.enum(['breakfast', 'snack1', 'lunch', 'snack2', 'supper', 'snack3']).optional(),
        alcohol: z.boolean().optional(),
        alcoholG: z.number().min(0).optional(),
      },
    },
    async ({ date, entryId, ...changes }) => text(await entryUpdate(uid, date, entryId, changes as EntryChanges)),
  )

  server.registerTool(
    'delete_entry',
    {
      description: 'Delete a diary entry (get its id from get_day). Returns updated day totals and remaining budget.',
      inputSchema: {
        date: z.string().regex(DATE_RX).describe('Day the entry is on, YYYY-MM-DD'),
        entryId: z.string().min(1),
      },
    },
    async ({ date, entryId }) => text(await entryDelete(uid, date, entryId)),
  )

  const recipeShape = {
    name: z.string().min(1).optional(),
    emoji: z.string().max(8).optional(),
    portions: z.number().int().min(1).max(64).optional(),
    notes: z.string().max(2000).optional(),
    sections: z.array(z.object({
      title: z.string(),
      method: z.string().default(''),
      ingredients: z.array(z.object({
        name: z.string().min(1),
        qty: z.number().min(0).default(0),
        unit: z.string().default('unit'),
        kcal: z.number().min(0).optional(),
        protein: z.number().min(0).optional(),
        carbs: z.number().min(0).optional(),
        fat: z.number().min(0).optional(),
        optional: z.boolean().optional(),
      })),
    })).optional(),
  }

  server.registerTool(
    'how_the_app_works',
    { description: "READ THIS FIRST: the app's philosophy, goal model (snapshots, endurance fuel, guardrails), data semantics and recommended tool flows. Call it once per conversation before coaching." },
    async () => ({ content: [{ type: 'text' as const, text: APP_GUIDE }] }),
  )

  server.registerTool(
    'search_recipes',
    {
      description: "List/search the user's saved recipes with per-portion macros and ids (needed for get_recipe / update_recipe).",
      inputSchema: { query: z.string().describe('Substring of the recipe name; empty lists all (max 30)') },
    },
    async ({ query }) => text(await recipesPayload(uid, query)),
  )

  server.registerTool(
    'get_recipe',
    {
      description: 'Full recipe: sections with ingredients (qty, unit, macros for the stated qty), methods, portions, notes.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => text(await recipeGet(uid, id)),
  )

  server.registerTool(
    'add_recipe',
    {
      description: "Save a recipe. Sections keep each component's ingredients AND method together. Ingredient macros are for the STATED qty (not per 100g) and may be omitted when unknown.",
      inputSchema: { ...recipeShape, name: z.string().min(1), sections: recipeShape.sections!.unwrap() },
    },
    async (input) => text(await recipeCreate(uid, input as Record<string, unknown>)),
  )

  server.registerTool(
    'update_recipe',
    {
      description: 'Update a recipe (id from search_recipes). Send the fields to replace — sending sections replaces ALL sections, so send the complete corrected list (ideal for filling in missing macros).',
      inputSchema: { id: z.string().min(1), ...recipeShape },
    },
    async ({ id, ...input }) => text(await recipeUpdate(uid, id, input as Record<string, unknown>)),
  )

  server.registerTool(
    'update_food',
    {
      description: 'Edit an existing library food. Get the id from search_foods. Only provided fields change.',
      inputSchema: { id: z.string().min(1), name: z.string().min(1).optional(), ...foodFields },
    },
    async ({ id, ...changes }) => text(await foodUpdate(uid, id, changes as Record<string, unknown>)),
  )

  return server
}

export const mcp = onRequest({ region: REGION, memory: '256MiB', timeoutSeconds: 120 }, async (req, res) => {
  // key is the last path segment: /mcp/<key> (hosting rewrite) or /<key> (direct)
  const segments = req.path.split('/').filter((s) => s && s !== 'mcp')
  const uid = await uidForKey(segments[segments.length - 1])

  if (!uid) {
    res.status(401).json({ error: 'Invalid or missing MCP key. Generate one in Meat Grinder → Settings.' })
    return
  }

  if (req.method !== 'POST') {
    // stateless server: no SSE stream or session teardown to offer
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. POST JSON-RPC messages to this endpoint.' },
      id: null,
    })
    return
  }

  try {
    const server = buildServer(uid)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    logger.error('MCP request failed', e)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
})

/* ---------- REST + OpenAPI for custom GPT Actions ---------- */

const MACROS_SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
  },
}

const WORKOUT_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    name: { type: ['string', 'null'] },
    minutes: { type: ['number', 'null'] },
    kcalBurned: { type: ['number', 'null'] },
    distanceKm: { type: ['number', 'null'] },
    slot: { type: ['string', 'null'] },
    when: { type: ['string', 'null'] },
  },
}

const DAY_SUMMARY_PROPS = {
  date: { type: 'string' },
  trainingDay: { type: 'boolean' },
  goal: { ...MACROS_SCHEMA, type: ['object', 'null'] },
  totals: MACROS_SCHEMA,
  sleepHours: { type: ['number', 'null'] },
  steps: { type: ['number', 'null'] },
  restingHeartRate: { type: ['number', 'null'] },
  alcohol: {
    type: ['object', 'null'],
    properties: { kcal: { type: 'number' }, pureAlcoholGrams: { type: 'number' } },
  },
  workouts: { type: 'array', items: WORKOUT_SCHEMA },
}

const FOOD_INPUT_PROPS = {
  name: { type: 'string', description: 'Food or drink name' },
  unit: { type: 'string', enum: ['g', 'ml', 'scoop', 'unit'], description: 'g/ml → macros per 100; scoop/unit → macros per 1' },
  kcal: { type: 'number' },
  protein: { type: 'number', description: 'grams' },
  carbs: { type: 'number', description: 'grams' },
  fat: { type: 'number', description: 'grams' },
  serving: { type: ['number', 'null'], description: 'default portion in g/ml (per-100 foods only)' },
  alcohol: { type: 'boolean', description: 'alcoholic drinks are shown in red and tracked' },
  alcoholG: { type: ['number', 'null'], description: 'grams of pure alcohol per basis' },
}

const openApiSchema = (host: string, pathKey: string | null = null) => ({
  openapi: '3.1.0',
  info: {
    title: 'Meat Grinder diary',
    description:
      "Access to the user's nutrition diary. Protein is a hard daily target; carbs/fat are flexible against the calorie budget; exercise burn is never added back to the budget.",
    version: '1.0.0',
  },
  // keyed variant: the key rides in the base URL — no auth headers involved
  servers: [{ url: pathKey ? `https://${host}/api/k/${pathKey}` : `https://${host}/api` }],
  ...(pathKey ? {} : { security: [{ ApiKeyAuth: [] }] }),
  components: {
    schemas: {},
    ...(pathKey ? {} : {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    }),
  },
  paths: {
    '/guide': {
      get: {
        operationId: 'howTheAppWorks',
        summary: 'READ THIS FIRST: app philosophy, goal model (snapshots, endurance fuel, deficit guardrails), data semantics and recommended action flows. Call once per conversation before coaching.',
        security: [],
        responses: { '200': { description: 'Markdown guide', content: { 'text/markdown': { schema: { type: 'string' } } } } },
      },
    },
    '/goals': {
      get: {
        operationId: 'getGoals',
        summary: 'Daily macro goals (rest + training day)',
        responses: {
          '200': {
            description: 'Goals',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    trainingEnabled: { type: 'boolean' },
                    rest: MACROS_SCHEMA,
                    training: MACROS_SCHEMA,
                  },
                },
              },
            },
          },
        },
      },
    },
    '/day': {
      get: {
        operationId: 'getDay',
        summary: 'Full diary for one day: entries, workouts, sleep, steps, resting HR, totals, goals',
        parameters: [
          { name: 'date', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
        ],
        responses: {
          '200': {
            description: 'Day diary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ...DAY_SUMMARY_PROPS,
                    entries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          amount: { type: ['number', 'null'] },
                          unit: { type: ['string', 'null'] },
                          mealSlot: { type: ['string', 'null'] },
                          alcohol: { type: 'boolean' },
                          ...MACROS_SCHEMA.properties,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/range': {
      get: {
        operationId: 'getRange',
        summary: 'Per-day summaries and averages over a date range (max 62 days)',
        parameters: [
          { name: 'start', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
          { name: 'end', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD inclusive' },
        ],
        responses: {
          '200': {
            description: 'Range summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    days: { type: 'array', items: { type: 'object', properties: DAY_SUMMARY_PROPS } },
                    daysLogged: { type: 'number' },
                    averagesOverLoggedDays: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/log': {
      post: {
        operationId: 'logFood',
        summary: "Log something the user ate into today's diary (or a given date). Pass foodId (from searchFoods) + amount in the food's basis, OR name + kcal (+ macros) for a one-off. Returns updated totals and remaining budget.",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  foodId: { type: 'string', description: 'Library food id from searchFoods (library mode)' },
                  amount: { type: 'number', description: "Amount in the food's basis: grams/ml for per-100 foods, scoops/units otherwise. Defaults to serving / 100 / 1" },
                  name: { type: 'string', description: 'One-off mode: what was eaten' },
                  kcal: { type: 'number', description: 'One-off mode: total calories eaten (required for one-off)' },
                  protein: { type: 'number', description: 'grams' },
                  carbs: { type: 'number', description: 'grams' },
                  fat: { type: 'number', description: 'grams' },
                  alcohol: { type: 'boolean' },
                  alcoholG: { type: 'number', description: 'grams of pure alcohol' },
                  meal: { type: 'string', enum: ['breakfast', 'snack1', 'lunch', 'snack2', 'supper', 'snack3'], description: 'Defaults to the slot matching the current time' },
                  date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Logged entry + updated day totals',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    date: { type: 'string' },
                    logged: { type: 'object', properties: { name: { type: 'string' }, mealSlot: { type: 'string' }, ...MACROS_SCHEMA.properties } },
                    totals: MACROS_SCHEMA,
                    goal: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                    remaining: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/recipes': {
      get: {
        operationId: 'searchRecipes',
        summary: "List/search the user's recipes with per-portion macros and ids",
        parameters: [
          { name: 'query', in: 'query', required: false, schema: { type: 'string' }, description: 'Substring of recipe name' },
        ],
        responses: {
          '200': {
            description: 'Recipes',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' }, name: { type: 'string' }, emoji: { type: ['string', 'null'] },
                      portions: { type: 'number' }, wholeDish: MACROS_SCHEMA, perPortion: MACROS_SCHEMA,
                      ingredientsMissingMacros: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'addRecipe',
        summary: 'Save a recipe: sections keep each component ingredients + method together; ingredient macros are for the stated qty and may be omitted when unknown',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
                type: 'object',
                required: ['name', 'sections'],
                properties: {
                  name: { type: 'string' },
                  emoji: { type: 'string' },
                  portions: { type: 'number', description: 'servings the whole recipe makes' },
                  notes: { type: 'string' },
                  sections: {
                    type: 'array',
                    description: 'one section per component (sauce / protein / wrap), method included',
                    items: {
                      type: 'object',
                      required: ['title', 'ingredients'],
                      properties: {
                        title: { type: 'string' },
                        method: { type: 'string', description: 'plain text, steps separated by newlines' },
                        ingredients: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: ['name'],
                            properties: {
                              name: { type: 'string' },
                              qty: { type: 'number' },
                              unit: { type: 'string', description: 'g, ml, tbsp, tsp, cloves, tins, unit…' },
                              kcal: { type: 'number', description: 'for the STATED qty, not per 100g' },
                              protein: { type: 'number' },
                              carbs: { type: 'number' },
                              fat: { type: 'number' },
                              optional: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              } } },
        },
        responses: {
          '200': { description: 'Created recipe', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } } } } },
        },
      },
    },
    '/recipes/{id}': {
      get: {
        operationId: 'getRecipe',
        summary: 'Full recipe with sections, ingredient macros, methods, portions, notes',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Recipe', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } } } } },
      },
      patch: {
        operationId: 'updateRecipe',
        summary: 'Update a recipe (sending sections replaces ALL sections — send the complete corrected list, ideal for filling in missing macros)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
                type: 'object',
                required: ['name', 'sections'],
                properties: {
                  name: { type: 'string' },
                  emoji: { type: 'string' },
                  portions: { type: 'number', description: 'servings the whole recipe makes' },
                  notes: { type: 'string' },
                  sections: {
                    type: 'array',
                    description: 'one section per component (sauce / protein / wrap), method included',
                    items: {
                      type: 'object',
                      required: ['title', 'ingredients'],
                      properties: {
                        title: { type: 'string' },
                        method: { type: 'string', description: 'plain text, steps separated by newlines' },
                        ingredients: {
                          type: 'array',
                          items: {
                            type: 'object',
                            required: ['name'],
                            properties: {
                              name: { type: 'string' },
                              qty: { type: 'number' },
                              unit: { type: 'string', description: 'g, ml, tbsp, tsp, cloves, tins, unit…' },
                              kcal: { type: 'number', description: 'for the STATED qty, not per 100g' },
                              protein: { type: 'number' },
                              carbs: { type: 'number' },
                              fat: { type: 'number' },
                              optional: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              } } },
        },
        responses: {
          '200': { description: 'Updated recipe', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, id: { type: 'string' } } } } } },
        },
      },
    },
    '/body': {
      post: {
        operationId: 'logBody',
        summary: "Log a weigh-in: weight kg (required), body fat %% and skeletal muscle kg (optional). Defaults to today; also updates the profile weight.",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['weightKg'],
                properties: {
                  weightKg: { type: 'number' },
                  bodyFatPct: { type: 'number' },
                  muscleKg: { type: 'number', description: 'skeletal muscle mass in kg' },
                  date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Saved weigh-in',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    date: { type: 'string' },
                    body: { type: 'object', properties: { weightKg: { type: 'number' }, bodyFatPct: { type: ['number', 'null'] }, muscleKg: { type: ['number', 'null'] } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/entry': {
      patch: {
        operationId: 'updateEntry',
        summary: 'Edit a diary entry (ids come from getDay). Changing only amount rescales macros proportionally; explicit macro values override. Returns updated totals and remaining budget.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date', 'entryId'],
                properties: {
                  date: { type: 'string', description: 'Day the entry is on, YYYY-MM-DD' },
                  entryId: { type: 'string', description: 'Entry id from getDay' },
                  name: { type: 'string' },
                  amount: { type: 'number', description: 'New amount in the entry unit — rescales macros unless macros are also given' },
                  kcal: { type: 'number' },
                  protein: { type: 'number' },
                  carbs: { type: 'number' },
                  fat: { type: 'number' },
                  meal: { type: 'string', enum: ['breakfast', 'snack1', 'lunch', 'snack2', 'supper', 'snack3'] },
                  alcohol: { type: 'boolean' },
                  alcoholG: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated entry + day totals',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    date: { type: 'string' },
                    entry: { type: 'object', properties: { name: { type: 'string' }, ...MACROS_SCHEMA.properties } },
                    totals: MACROS_SCHEMA,
                    goal: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                    remaining: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteEntry',
        summary: 'Delete a diary entry (ids come from getDay). Returns updated totals and remaining budget.',
        parameters: [
          { name: 'date', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
          { name: 'entryId', in: 'query', required: true, schema: { type: 'string' }, description: 'Entry id from getDay' },
        ],
        responses: {
          '200': {
            description: 'Deleted + day totals',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    date: { type: 'string' },
                    deleted: { type: ['object', 'null'], properties: { name: { type: 'string' }, ...MACROS_SCHEMA.properties } },
                    totals: MACROS_SCHEMA,
                    goal: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                    remaining: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/foods': {
      post: {
        operationId: 'addFood',
        summary: "Add a food or drink to the user's library (macros per 100 for g/ml, per 1 for scoop/unit)",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name', 'kcal'], properties: FOOD_INPUT_PROPS },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created food',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, id: { type: 'string' }, food: { type: 'object', properties: FOOD_INPUT_PROPS } },
                },
              },
            },
          },
        },
      },
      get: {
        operationId: 'searchFoods',
        summary: "Search the user's food/drink library (returns ids usable with updateFood)",
        parameters: [
          { name: 'query', in: 'query', required: false, schema: { type: 'string' }, description: 'Substring of food name' },
        ],
        responses: {
          '200': {
            description: 'Foods',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      unit: { type: ['string', 'null'] },
                      serving: { type: ['number', 'null'] },
                      alcohol: { type: ['boolean', 'null'] },
                      alcoholG: { type: ['number', 'null'] },
                      ...MACROS_SCHEMA.properties,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/foods/{id}': {
      patch: {
        operationId: 'updateFood',
        summary: 'Edit an existing library food — only provided fields change. Get the id from searchFoods.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Food id from searchFoods' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: FOOD_INPUT_PROPS },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated food',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, id: { type: 'string' }, changes: { type: 'object', properties: FOOD_INPUT_PROPS } },
                },
              },
            },
          },
        },
      },
    },
  },
})

export const api = onRequest({ region: REGION, memory: '256MiB', timeoutSeconds: 60 }, async (req, res) => {
  let path = (req.path.startsWith('/api') ? req.path.slice(4) : req.path) || '/'

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // keyed variant: /api/k/<key>/… carries the key in the URL so clients that
  // mangle auth headers (GPT Actions) can use Authentication: None
  let pathKey: string | null = null
  const keyed = path.match(/^\/k\/([a-f0-9]{48})(\/.*)?$/)
  if (keyed) {
    pathKey = keyed[1]
    path = keyed[2] || '/'
  }

  // behind the hosting rewrite the original domain arrives via x-forwarded-host
  const host = req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host') || 'localhost'

  if (req.method === 'GET' && path === '/guide') {
    res.type('text/markdown').send(APP_GUIDE)
    return
  }

  // schema is public — it contains no data or secrets (keyed variant embeds
  // the caller's own key in the server URL and needs no auth config)
  if (req.method === 'GET' && path === '/openapi.json') {
    res.json(openApiSchema(host, pathKey))
    return
  }

  const headerKey = req.get('x-api-key') ?? req.get('authorization')?.replace(/^(Bearer|Basic)\s+/i, '')
  const uid = await uidForKey(pathKey ?? headerKey?.trim())
  if (!uid) {
    // diagnostic: log the shape of what arrived, never the value itself
    logger.info(
      `api auth failed: ${req.method} ${path} ua="${req.get('user-agent')?.slice(0, 60)}" ` +
      `xApiKey=${req.get('x-api-key') ? `len ${req.get('x-api-key')!.trim().length}` : 'absent'} ` +
      `authHeader=${req.get('authorization') ? `"${req.get('authorization')!.slice(0, 10)}…"` : 'absent'}`,
    )
    res.status(401).json({ error: 'Invalid or missing X-API-Key. Generate one in Meat Grinder → Settings.' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const foodIdMatch = path.match(/^\/foods\/([A-Za-z0-9]+)$/)

  try {
    const recipeIdMatch = path.match(/^\/recipes\/([A-Za-z0-9]+)$/)
    if (req.method === 'GET' && path === '/recipes') {
      res.json(await recipesPayload(uid, String(req.query.query ?? '')))
    } else if (req.method === 'GET' && recipeIdMatch) {
      try {
        res.json(await recipeGet(uid, recipeIdMatch[1]))
      } catch (e) {
        res.status(404).json({ error: (e as Error).message })
      }
    } else if (req.method === 'POST' && path === '/recipes') {
      try {
        res.json(await recipeCreate(uid, body))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'PATCH' && recipeIdMatch) {
      try {
        res.json(await recipeUpdate(uid, recipeIdMatch[1], body))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'POST' && path === '/body') {
      const { date, ...input } = body as { date?: string; weightKg: number; bodyFatPct?: number; muscleKg?: number }
      try {
        res.json(await logBody(uid, date && DATE_RX.test(date) ? date : localDateKey(), input))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'PATCH' && path === '/entry') {
      const { date, entryId, ...changes } = body as { date?: string; entryId?: string } & EntryChanges
      if (!date || !DATE_RX.test(date) || !entryId) {
        res.status(400).json({ error: 'date (YYYY-MM-DD) and entryId are required — get ids from getDay' })
        return
      }
      try {
        res.json(await entryUpdate(uid, date, entryId, changes))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'DELETE' && path === '/entry') {
      const date = String(req.query.date ?? '')
      const entryId = String(req.query.entryId ?? '')
      if (!DATE_RX.test(date) || !entryId) {
        res.status(400).json({ error: 'date (YYYY-MM-DD) and entryId query params are required — get ids from getDay' })
        return
      }
      try {
        res.json(await entryDelete(uid, date, entryId))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'POST' && path === '/log') {
      try {
        res.json(await logFood(uid, body as LogFoodInput))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'POST' && path === '/foods') {
      try {
        res.json(await foodCreate(uid, body))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'PATCH' && foodIdMatch) {
      try {
        res.json(await foodUpdate(uid, foodIdMatch[1], body))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method !== 'GET') {
      res.status(404).json({ error: 'Unknown endpoint. See /api/openapi.json' })
    } else if (path === '/goals') {
      res.json(await goalsPayload(uid))
    } else if (path === '/day') {
      const date = String(req.query.date ?? '')
      if (!DATE_RX.test(date)) {
        res.status(400).json({ error: 'date must be YYYY-MM-DD' })
        return
      }
      const garminSync = await syncIfStale(uid)
      res.json({ garminSync, ...(await dayPayload(uid, date)) })
    } else if (path === '/range') {
      const start = String(req.query.start ?? '')
      const end = String(req.query.end ?? '')
      if (!DATE_RX.test(start) || !DATE_RX.test(end)) {
        res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
        return
      }
      const garminSync = await syncIfStale(uid)
      res.json({ garminSync, ...(await rangePayload(uid, start, end)) })
    } else if (path === '/foods') {
      res.json(await foodsPayload(uid, String(req.query.query ?? '')))
    } else {
      res.status(404).json({ error: 'Unknown endpoint. See /api/openapi.json' })
    }
  } catch (e) {
    logger.error('REST api request failed', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ---------- key management ---------- */

export const mcpKeyGenerate = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')

  // revoke any previous key
  const existing = await db.doc(`users/${uid}/meta/mcp`).get()
  const oldKey = (existing.data() as { key?: string } | undefined)?.key
  if (oldKey) await db.doc(`mcpKeys/${oldKey}`).delete()

  const key = crypto.randomBytes(24).toString('hex')
  await db.doc(`mcpKeys/${key}`).set({ uid, createdAt: Date.now() })
  await db.doc(`users/${uid}/meta/mcp`).set({ key, createdAt: Date.now() })
  return { ok: true, key }
})

export const mcpKeyRevoke = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  const existing = await db.doc(`users/${uid}/meta/mcp`).get()
  const oldKey = (existing.data() as { key?: string } | undefined)?.key
  if (oldKey) await db.doc(`mcpKeys/${oldKey}`).delete()
  await db.doc(`users/${uid}/meta/mcp`).delete()
  return { ok: true }
})
