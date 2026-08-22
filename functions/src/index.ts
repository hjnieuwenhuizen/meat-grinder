// Day boundaries are fixed to Africa/Johannesburg for now (single-market app).
process.env.TZ = 'Africa/Johannesburg'

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import * as crypto from 'crypto'
import { GarminConnect } from 'garmin-connect'
import { ingestGarminActivity, type MergeWorkout } from './merge.js'

if (!getApps().length) initializeApp()
const db = getFirestore()

export { mcp, api, mcpKeyGenerate, mcpKeyRevoke } from './mcp.js'

const REGION = 'europe-west1'

type MealId = 'breakfast' | 'snack1' | 'lunch' | 'snack2' | 'supper' | 'snack3'
type WorkoutTypeId =
  | 'push' | 'legs' | 'pull' | 'strength'
  | 'run' | 'walk' | 'ride' | 'swim' | 'hike' | 'stairs' | 'cardio'
  | 'other'

interface WorkoutSet {
  id: string
  exercise: string
  weightKg?: number | null
  reps?: number | null
}

interface Workout {
  id: string
  garminId?: number
  type: WorkoutTypeId
  /** sets captured live in the app — the Garmin activity merges onto this card */
  sets?: WorkoutSet[]
  /** when live logging began, for time-matching the Garmin activity */
  startedAt?: number | null
  name: string | null
  duration: number | null
  kcal: number | null
  distance: number | null
  when: 'before' | 'after'
  meal: MealId
  avgHr?: number | null
  maxHr?: number | null
  paceMinKm?: number | null
  speedKmh?: number | null
  elevM?: number | null
  cadence?: number | null
}

interface DayDoc {
  training: boolean
  entries: unknown[]
  workouts: Workout[]
  sleep?: number | null
  garmin?: Record<string, number | string | null>
  goals?: { trainingEnabled: boolean; rest: unknown; training: unknown }
}

interface GarminActivity {
  activityId: number
  activityName?: string
  activityType?: { typeKey?: string }
  startTimeLocal?: string
  duration?: number
  calories?: number
  distance?: number
  averageHR?: number
  maxHR?: number
  /** metres per second */
  averageSpeed?: number
  elevationGain?: number
  averageRunningCadenceInStepsPerMinute?: number
}

const tokensRef = (uid: string) => db.doc(`users/${uid}/meta/garminTokens`)
const statusRef = (uid: string) => db.doc(`users/${uid}/meta/garmin`)
const registryRef = (uid: string) => db.doc(`garminUsers/${uid}`)
// credentials parked here ONLY while Garmin rate-limits our IP; deleted on first successful login
const pendingRef = (uid: string) => db.doc(`users/${uid}/meta/garminPending`)

const keyOf = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// same slot boundaries as the app's defaultMealNow()
const slotFor = (hour: number): MealId => {
  if (hour < 10.5) return 'breakfast'
  if (hour < 12) return 'snack1'
  if (hour < 14.5) return 'lunch'
  if (hour < 17) return 'snack2'
  if (hour < 20.5) return 'supper'
  return 'snack3'
}

// map Garmin activity to the app's workout types; strength sessions named
// "push"/"pull"/"legs" in Garmin land on the right day type
const mapType = (act: GarminActivity): WorkoutTypeId => {
  const key = act.activityType?.typeKey ?? ''
  const name = (act.activityName ?? '').toLowerCase()
  if (/push/.test(name)) return 'push'
  if (/pull/.test(name)) return 'pull'
  if (/leg/.test(name)) return 'legs'
  if (key.includes('running') || key.includes('treadmill')) return 'run'
  if (key.includes('strength')) return 'strength'
  if (key.includes('cycling') || key.includes('biking') || key.includes('ride')) return 'ride'
  if (key.includes('hiking')) return 'hike'
  if (key.includes('walking')) return 'walk'
  if (key.includes('swim')) return 'swim'
  if (key.includes('stair')) return 'stairs'
  if (key.includes('cardio') || key.includes('elliptical') || key.includes('hiit') || key.includes('fitness_equipment')) return 'cardio'
  return 'other'
}

const DISTANCE_TYPES: WorkoutTypeId[] = ['run', 'walk', 'ride', 'swim', 'hike']

async function clientFor(uid: string): Promise<GarminConnect> {
  const snap = await tokensRef(uid).get()
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Garmin is not connected.')
  const { oauth1, oauth2 } = snap.data() as { oauth1: never; oauth2: never }
  // credentials are never stored — token refresh is handled via oauth1
  const client = new GarminConnect({ username: 'unused', password: 'unused' })
  client.loadToken(oauth1, oauth2)
  return client
}

// visible sync trail for debugging — last 20 runs at users/{uid}/meta/garminLog
const garminLogRef = (uid: string) => db.doc(`users/${uid}/meta/garminLog`)
async function pushGarminLog(uid: string, entry: Record<string, unknown>) {
  try {
    const prev = ((await garminLogRef(uid).get()).data()?.entries ?? []) as unknown[]
    await garminLogRef(uid).set({ entries: [entry, ...prev].slice(0, 20) })
  } catch (e) {
    logger.warn(`garminLog write failed for ${uid}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function syncUser(uid: string, full = false, trigger = 'manual'): Promise<string> {
  const client = await clientFor(uid)
  const settings = (await db.doc(`users/${uid}/meta/settings`).get()).data() ?? {}

  const now = new Date()
  const lastNDays = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      return keyOf(d)
    })
  // normal runs cover the recent window; a full resync backfills a month
  const sleepKeys = lastNDays(full ? 30 : 2)
  const actKeys = lastNDays(full ? 30 : 7)

  const dayCache: Record<string, DayDoc & { _dirty: boolean }> = {}
  const loadDay = async (key: string) => {
    if (!dayCache[key]) {
      const snap = await db.doc(`users/${uid}/days/${key}`).get()
      const base: DayDoc = snap.exists
        ? { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc>) }
        : { training: false, entries: [], workouts: [] }
      dayCache[key] = { ...base, _dirty: false }
    }
    return dayCache[key]
  }

  let sleepSet = 0
  let workoutsAdded = 0

  // sleep: hours fill only when the user hasn't typed a value, but the
  // wellness metrics riding along (score, HRV, respiration, SpO2) are
  // captured regardless — they have no manual lane to collide with
  const sleepMeta: Record<string, Record<string, number>> = {}
  for (const key of sleepKeys) {
    try {
      const data = await client.getSleepData(new Date(`${key}T12:00:00`))
      const dto = data?.dailySleepDTO as
        | (typeof data.dailySleepDTO & {
            averageSpO2Value?: number
            averageRespirationValue?: number
            avgOvernightHrv?: number
            sleepScores?: { overall?: { value?: number } }
          })
        | undefined
      const meta: Record<string, number> = {}
      if (dto?.sleepScores?.overall?.value) meta.sleepScore = Math.round(dto.sleepScores.overall.value)
      if (dto?.avgOvernightHrv) meta.hrv = Math.round(dto.avgOvernightHrv)
      if (dto?.averageRespirationValue) meta.respiration = Math.round(dto.averageRespirationValue * 10) / 10
      if (dto?.averageSpO2Value) meta.spo2 = Math.round(dto.averageSpO2Value)
      if (Object.keys(meta).length) sleepMeta[key] = meta
      const secs = dto?.sleepTimeSeconds
      if (!secs || secs <= 0) continue
      const day = await loadDay(key)
      if (day.sleep == null) {
        day.sleep = Math.round((secs / 3600) * 4) / 4
        day._dirty = true
        sleepSet++
      }
    } catch (e) {
      logger.info(`${uid} no sleep data for ${key}: ${(e as Error).message}`)
    }
  }

  // daily wellness: steps + resting heart rate for yesterday/today.
  // Steps come from BOTH endpoints — the daily report (lags until a full
  // watch sync) AND the live user summary (what the Garmin app shows) — and
  // we take the max: step counts only ever grow during a day.
  let profileName: string | null = null
  const stepsLog: Record<string, unknown>[] = []
  for (const key of sleepKeys) {
    const date = new Date(`${key}T12:00:00`)
    const g: Record<string, number | string> = { ...(sleepMeta[key] ?? {}) }
    let report = 0
    let live = 0
    let stepErr: string | null = null
    try {
      report = (await client.getSteps(date)) || 0
    } catch (e) {
      stepErr = `report: ${(e as Error).message}`
    }
    try {
      profileName ??= (await client.getUserProfile()).displayName
      const sum = await client.client.get<{
        totalSteps?: number
        activeKilocalories?: number
        floorsAscended?: number
        averageStressLevel?: number
        maxStressLevel?: number
        bodyBatteryMostRecentValue?: number
        bodyBatteryHighestValue?: number
        bodyBatteryLowestValue?: number
        moderateIntensityMinutes?: number
        vigorousIntensityMinutes?: number
      }>(
        `https://connectapi.garmin.com/usersummary-service/usersummary/daily/${profileName}?calendarDate=${key}`,
      )
      live = sum?.totalSteps ?? 0
      if (sum?.activeKilocalories) g.activeKcal = Math.round(sum.activeKilocalories)
      if (sum?.floorsAscended) g.floors = Math.round(sum.floorsAscended)
      if (sum?.averageStressLevel && sum.averageStressLevel > 0) g.stress = Math.round(sum.averageStressLevel)
      if (sum?.maxStressLevel && sum.maxStressLevel > 0) g.stressMax = Math.round(sum.maxStressLevel)
      if (sum?.bodyBatteryMostRecentValue != null) g.bodyBattery = Math.round(sum.bodyBatteryMostRecentValue)
      if (sum?.bodyBatteryHighestValue != null) g.bodyBatteryHigh = Math.round(sum.bodyBatteryHighestValue)
      if (sum?.bodyBatteryLowestValue != null) g.bodyBatteryLow = Math.round(sum.bodyBatteryLowestValue)
      const intensity = (sum?.moderateIntensityMinutes ?? 0) + 2 * (sum?.vigorousIntensityMinutes ?? 0)
      if (intensity > 0) g.intensityMin = intensity
    } catch (e) {
      stepErr = `${stepErr ? stepErr + ' · ' : ''}live: ${(e as Error).message}`
    }
    const best = Math.max(report, live)
    if (best > 0) g.steps = best
    try {
      const hr = await client.getHeartRate(date)
      if (hr?.restingHeartRate) g.restingHr = hr.restingHeartRate
    } catch (e) {
      logger.info(`${uid} no heart rate for ${key}: ${(e as Error).message}`)
    }
    // training readiness — Garmin's own "suggested rest" signal
    try {
      const tr = await client.client.get<{ score?: number; level?: string }[]>(
        `https://connectapi.garmin.com/metrics-service/metrics/trainingreadiness/${key}`,
      )
      if (tr?.[0]?.score != null) {
        g.readiness = Math.round(tr[0].score)
        if (tr[0].level) g.readinessLevel = String(tr[0].level)
      }
    } catch { /* not all watches have training readiness */ }
    // HRV status vs personal baseline
    try {
      const hrv = await client.client.get<{ hrvSummary?: { lastNightAvg?: number; status?: string } }>(
        `https://connectapi.garmin.com/hrv-service/hrv/${key}`,
      )
      if (hrv?.hrvSummary?.lastNightAvg && !g.hrv) g.hrv = Math.round(hrv.hrvSummary.lastNightAvg)
      if (hrv?.hrvSummary?.status) g.hrvStatus = String(hrv.hrvSummary.status)
    } catch { /* not all watches record HRV */ }
    stepsLog.push({ key, report, live, wrote: best > 0 ? best : null, hr: g.restingHr ?? null, ...(stepErr ? { error: stepErr } : {}) })
    logger.info(`${uid} steps ${key}: report=${report} live=${live} wrote=${best}${stepErr ? ` err=${stepErr}` : ''}`)
    if (!Object.keys(g).length) continue
    const day = await loadDay(key)
    const merged = { ...(day.garmin ?? {}), ...g }
    if (JSON.stringify(merged) !== JSON.stringify(day.garmin ?? {})) {
      day.garmin = merged
      day._dirty = true
    }
  }

  // activities: keep the ones in the window, dedupe by garminId
  const acts = (await client.getActivities(0, full ? 100 : 30)) as GarminActivity[]
  for (const act of acts ?? []) {
    const start = act.startTimeLocal // "2026-08-08 17:23:00"
    if (!start) continue
    const dateKey = start.slice(0, 10)
    if (!actKeys.includes(dateKey)) continue

    const day = await loadDay(dateKey)

    const type = mapType(act)
    const paced = ['run', 'walk', 'hike'].includes(type)
    const metrics = {
      avgHr: act.averageHR ? Math.round(act.averageHR) : null,
      maxHr: act.maxHR ? Math.round(act.maxHR) : null,
      paceMinKm: paced && act.averageSpeed && act.averageSpeed > 0
        ? Math.round((1000 / act.averageSpeed / 60) * 100) / 100
        : null,
      speedKmh: type === 'ride' && act.averageSpeed ? Math.round(act.averageSpeed * 3.6 * 10) / 10 : null,
      elevM: act.elevationGain ? Math.round(act.elevationGain) : null,
      cadence: type === 'run' && act.averageRunningCadenceInStepsPerMinute
        ? Math.round(act.averageRunningCadenceInStepsPerMinute)
        : null,
    }

    const hour = Number(start.slice(11, 13)) + Number(start.slice(14, 16)) / 60
    const { workouts, action } = ingestGarminActivity(
      day.workouts as unknown as MergeWorkout[],
      {
        activityId: act.activityId,
        type,
        name: act.activityName?.trim() || null,
        startMs: new Date(start.replace(' ', 'T')).getTime(),
        durationMin: act.duration ? Math.round(act.duration / 60) : null,
        kcal: act.calories ? Math.round(act.calories) : null,
        distanceKm: DISTANCE_TYPES.includes(type) && act.distance ? Math.round((act.distance / 1000) * 10) / 10 : null,
        meal: slotFor(hour),
        metrics,
      },
      () => crypto.randomUUID(),
    )
    if (action === 'unchanged') continue
    day.workouts = workouts as unknown as Workout[]
    day._dirty = true
    logger.info(`Garmin ${act.activityId} ${dateKey}: ${action}`)
    if (action === 'backfilled') continue
    if ((settings as { trainingEnabled?: boolean }).trainingEnabled) day.training = true
    workoutsAdded++
  }

  for (const [key, day] of Object.entries(dayCache)) {
    if (!day._dirty) continue
    // freeze current goals onto newly-touched days (goal-snapshot model)
    const st = settings as { trainingEnabled?: boolean; rest?: unknown; training?: unknown }
    if (!day.goals && st.rest) {
      day.goals = { trainingEnabled: Boolean(st.trainingEnabled), rest: st.rest, training: st.training ?? st.rest }
    }
    const { _dirty, ...data } = day
    void _dirty
    await db.doc(`users/${uid}/days/${key}`).set(data)
  }

  // persist possibly-refreshed tokens
  const t = client.exportToken()
  await tokensRef(uid).set({ oauth1: t.oauth1, oauth2: t.oauth2 })

  const summary = `${workoutsAdded} workout${workoutsAdded === 1 ? '' : 's'}, ${sleepSet} sleep entr${sleepSet === 1 ? 'y' : 'ies'}`
  await statusRef(uid).set(
    { connected: true, lastSync: Date.now(), lastResult: summary, lastError: null },
    { merge: true },
  )
  logger.info(`Synced ${uid}: ${summary}`)
  await pushGarminLog(uid, { at: Date.now(), trigger, full, summary, steps: stepsLog })
  return summary
}

// Freshness gate shared by app-open and LLM reads: sync at most once per
// 10 minutes per user so Garmin isn't hammered and reads stay fast.
export async function syncIfStale(uid: string, maxAgeMs = 10 * 60_000): Promise<string> {
  const status = (await statusRef(uid).get()).data() as
    | { connected?: boolean; lastSync?: number }
    | undefined
  if (!status?.connected) return 'not-connected'
  if (status.lastSync && Date.now() - status.lastSync < maxAgeMs) return 'fresh'
  try {
    await syncUser(uid, false, 'auto (app open / AI read)')
    return 'synced'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.warn(`syncIfStale failed for ${uid}: ${msg}`)
    await pushGarminLog(uid, { at: Date.now(), trigger: 'auto (app open / AI read)', error: msg })
    return 'sync-failed'
  }
}

const isRateLimit = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('429') || msg.toLowerCase().includes('rate limit')
}

const isBadLogin = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthorized')
}

// try to log in with parked credentials; returns true when connected
async function tryPendingLogin(uid: string): Promise<boolean> {
  const snap = await pendingRef(uid).get()
  if (!snap.exists) return false
  const { email, password } = snap.data() as { email: string; password: string }

  const client = new GarminConnect({ username: email, password })
  try {
    await client.login()
    await client.getUserProfile()
  } catch (e) {
    if (isRateLimit(e)) {
      await statusRef(uid).set(
        { pending: true, lastError: 'Garmin is still rate-limiting the server — retrying automatically.' },
        { merge: true },
      )
      return false
    }
    if (isBadLogin(e)) {
      // wrong credentials: stop retrying, make the user re-enter them
      await pendingRef(uid).delete()
      await registryRef(uid).delete()
      await statusRef(uid).set(
        { pending: false, connected: false, lastError: 'Garmin rejected the login — check your email and password and connect again.' },
        { merge: true },
      )
      return false
    }
    throw e
  }

  const t = client.exportToken()
  await tokensRef(uid).set({ oauth1: t.oauth1, oauth2: t.oauth2 })
  await pendingRef(uid).delete()
  await statusRef(uid).set(
    { connected: true, pending: false, connectedAt: Date.now(), lastError: null },
    { merge: true },
  )
  logger.info(`Pending Garmin login succeeded for ${uid}`)
  return true
}

const friendly = (e: unknown): HttpsError => {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return new HttpsError(
      'resource-exhausted',
      'Garmin is rate-limiting the server right now. Try again in ~15 minutes, or connect with tokens (Advanced).',
    )
  }
  if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
    return new HttpsError('unauthenticated', 'Garmin rejected the login. Check your email and password.')
  }
  return new HttpsError('internal', msg)
}

// Connect: login once with email+password (discarded) OR accept pre-made tokens.
export const garminConnect = onCall(
  { region: REGION, memory: '256MiB', timeoutSeconds: 120 },
  async (req) => {
    const uid = req.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
    const { email, password, tokens } = (req.data ?? {}) as {
      email?: string
      password?: string
      tokens?: { oauth1?: never; oauth2?: never }
    }

    const client = new GarminConnect({ username: email ?? 'unused', password: password ?? 'unused' })
    try {
      if (tokens?.oauth1 && tokens?.oauth2) {
        client.loadToken(tokens.oauth1, tokens.oauth2)
      } else if (email && password) {
        await client.login()
      } else {
        throw new HttpsError('invalid-argument', 'Provide email + password, or tokens.')
      }
      await client.getUserProfile() // verify the session actually works
    } catch (e) {
      if (e instanceof HttpsError) throw e
      // Garmin blocks logins from cloud IPs intermittently — park the
      // credentials and let the scheduled sync keep retrying until it works.
      if (isRateLimit(e) && email && password) {
        await pendingRef(uid).set({ email, password, savedAt: Date.now() })
        await registryRef(uid).set({ enabled: true })
        await statusRef(uid).set(
          { connected: false, pending: true, lastError: null },
          { merge: true },
        )
        return {
          ok: true,
          pending: true,
          summary: 'Garmin is rate-limiting right now — connection saved, retrying automatically.',
        }
      }
      throw friendly(e)
    }

    const t = client.exportToken()
    await tokensRef(uid).set({ oauth1: t.oauth1, oauth2: t.oauth2 })
    await pendingRef(uid).delete() // a token connect supersedes any queued password retry
    await registryRef(uid).set({ enabled: true })
    await statusRef(uid).set({ connected: true, pending: false, connectedAt: Date.now(), lastError: null }, { merge: true })

    try {
      return { ok: true, summary: await syncUser(uid) }
    } catch (e) {
      logger.warn(`First sync after connect failed for ${uid}`, e)
      return { ok: true, summary: 'connected — first sync will run shortly' }
    }
  },
)

export const garminSyncUser = onCall(
  { region: REGION, memory: '256MiB', timeoutSeconds: 540 },
  async (req) => {
    const uid = req.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
    const { full, ifStale } = (req.data ?? {}) as { full?: boolean; ifStale?: boolean }
    // app-open freshness ping: cheap no-op unless the last sync is old
    if (ifStale) return { ok: true, summary: await syncIfStale(uid) }
    try {
      return { ok: true, summary: await syncUser(uid, Boolean(full)) }
    } catch (e) {
      if (e instanceof HttpsError) throw e
      throw friendly(e)
    }
  },
)

export const garminDisconnect = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  await tokensRef(uid).delete()
  await pendingRef(uid).delete()
  await registryRef(uid).delete()
  await statusRef(uid).set({ connected: false, pending: false }, { merge: true })
  return { ok: true }
})

export const garminSync = onSchedule(
  { schedule: 'every 3 hours', timeZone: 'Africa/Johannesburg', region: REGION, memory: '256MiB', timeoutSeconds: 540 },
  async () => {
    // one-time migration from the single-user era
    const legacy = await db.doc('system/garminTokens').get()
    if (legacy.exists) {
      const reg = await db.collection('garminUsers').limit(1).get()
      if (reg.empty) {
        const { users } = await getAuth().listUsers(2)
        if (users[0]) {
          await tokensRef(users[0].uid).set(legacy.data()!)
          await registryRef(users[0].uid).set({ enabled: true })
          await statusRef(users[0].uid).set({ connected: true }, { merge: true })
          logger.info(`Migrated legacy Garmin tokens to ${users[0].uid}`)
        }
      }
      await db.doc('system/garminTokens').delete()
    }

    const uids = (await db.collection('garminUsers').get()).docs.map((d) => d.id)
    logger.info(`Garmin sync for ${uids.length} user(s)`)
    for (const uid of uids) {
      try {
        // users whose login was rate-limited at connect time: retry it first
        if (!(await tokensRef(uid).get()).exists) {
          const ok = await tryPendingLogin(uid)
          if (!ok) continue
        }
        await syncUser(uid, false, 'scheduled (every 3h)')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn(`Sync failed for ${uid}: ${msg}`)
        await statusRef(uid).set({ lastError: msg, lastErrorAt: Date.now() }, { merge: true })
        await pushGarminLog(uid, { at: Date.now(), trigger: 'scheduled (every 3h)', error: msg })
      }
    }
  },
)
