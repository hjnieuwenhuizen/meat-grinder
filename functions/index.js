// Day boundaries are fixed to Africa/Johannesburg for now (single-market app).
process.env.TZ = 'Africa/Johannesburg'

const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const crypto = require('crypto')
const { GarminConnect } = require('garmin-connect')

initializeApp()
const db = getFirestore()

const REGION = 'europe-west1'

const tokensRef = (uid) => db.doc(`users/${uid}/meta/garminTokens`)
const statusRef = (uid) => db.doc(`users/${uid}/meta/garmin`)
const registryRef = (uid) => db.doc(`garminUsers/${uid}`)

const keyOf = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// same slot boundaries as the app's defaultMealNow()
const slotFor = (hour) => {
  if (hour < 10.5) return 'breakfast'
  if (hour < 12) return 'snack1'
  if (hour < 14.5) return 'lunch'
  if (hour < 17) return 'snack2'
  if (hour < 20.5) return 'supper'
  return 'snack3'
}

// map Garmin activity to the app's workout types; strength sessions named
// "push"/"pull"/"legs" in Garmin land on the right day type
const mapType = (act) => {
  const key = act.activityType?.typeKey ?? ''
  const name = (act.activityName ?? '').toLowerCase()
  if (key.includes('running') || key.includes('treadmill')) return 'run'
  if (/push/.test(name)) return 'push'
  if (/pull/.test(name)) return 'pull'
  if (/leg/.test(name)) return 'legs'
  return 'other'
}

async function clientFor(uid) {
  const snap = await tokensRef(uid).get()
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Garmin is not connected.')
  const { oauth1, oauth2 } = snap.data()
  // credentials are never stored — token refresh is handled via oauth1
  const client = new GarminConnect({ username: 'unused', password: 'unused' })
  client.loadToken(oauth1, oauth2)
  return client
}

async function syncUser(uid) {
  const client = await clientFor(uid)
  const settings = (await db.doc(`users/${uid}/meta/settings`).get()).data() ?? {}

  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const sleepKeys = [keyOf(yesterday), keyOf(now)]
  const actKeys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    return keyOf(d)
  })

  const dayCache = {}
  const loadDay = async (key) => {
    if (!dayCache[key]) {
      const snap = await db.doc(`users/${uid}/days/${key}`).get()
      dayCache[key] = snap.exists
        ? { training: false, entries: [], workouts: [], ...snap.data() }
        : { training: false, entries: [], workouts: [] }
      dayCache[key]._dirty = false
    }
    return dayCache[key]
  }

  let sleepSet = 0
  let workoutsAdded = 0

  // sleep: fill only when the user hasn't typed a value
  for (const key of sleepKeys) {
    try {
      const data = await client.getSleepData(new Date(`${key}T12:00:00`))
      const secs = data?.dailySleepDTO?.sleepTimeSeconds
      if (!secs || secs <= 0) continue
      const day = await loadDay(key)
      if (day.sleep == null) {
        day.sleep = Math.round((secs / 3600) * 4) / 4
        day._dirty = true
        sleepSet++
      }
    } catch (e) {
      logger.info(`${uid} no sleep data for ${key}: ${e.message}`)
    }
  }

  // activities: last 30, keep the ones in the window, dedupe by garminId
  const acts = await client.getActivities(0, 30)
  for (const act of acts ?? []) {
    const start = act.startTimeLocal // "2026-08-08 17:23:00"
    if (!start) continue
    const dateKey = start.slice(0, 10)
    if (!actKeys.includes(dateKey)) continue

    const day = await loadDay(dateKey)
    if (day.workouts.some((w) => w.garminId === act.activityId)) continue

    const hour = Number(start.slice(11, 13)) + Number(start.slice(14, 16)) / 60
    const type = mapType(act)
    day.workouts.push({
      id: crypto.randomUUID(),
      garminId: act.activityId,
      type,
      duration: act.duration ? Math.round(act.duration / 60) : null,
      kcal: act.calories ? Math.round(act.calories) : null,
      distance: type === 'run' && act.distance ? Math.round((act.distance / 1000) * 10) / 10 : null,
      when: 'before',
      meal: slotFor(hour),
    })
    if (settings.trainingEnabled) day.training = true
    day._dirty = true
    workoutsAdded++
  }

  for (const [key, day] of Object.entries(dayCache)) {
    if (!day._dirty) continue
    const { _dirty, ...data } = day
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
  return summary
}

const friendly = (e) => {
  const msg = e?.message ?? String(e)
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
exports.garminConnect = onCall({ region: REGION, memory: '256MiB', timeoutSeconds: 120 }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  const { email, password, tokens } = req.data ?? {}

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
    throw friendly(e)
  }

  const t = client.exportToken()
  await tokensRef(uid).set({ oauth1: t.oauth1, oauth2: t.oauth2 })
  await registryRef(uid).set({ enabled: true })
  await statusRef(uid).set({ connected: true, connectedAt: Date.now(), lastError: null }, { merge: true })

  try {
    return { ok: true, summary: await syncUser(uid) }
  } catch (e) {
    logger.warn(`First sync after connect failed for ${uid}`, e)
    return { ok: true, summary: 'connected — first sync will run shortly' }
  }
})

exports.garminSyncUser = onCall({ region: REGION, memory: '256MiB', timeoutSeconds: 300 }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  try {
    return { ok: true, summary: await syncUser(uid) }
  } catch (e) {
    if (e instanceof HttpsError) throw e
    throw friendly(e)
  }
})

exports.garminDisconnect = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  await tokensRef(uid).delete()
  await registryRef(uid).delete()
  await statusRef(uid).set({ connected: false }, { merge: true })
  return { ok: true }
})

exports.garminSync = onSchedule(
  { schedule: 'every 3 hours', timeZone: 'Africa/Johannesburg', region: REGION, memory: '256MiB', timeoutSeconds: 540 },
  async () => {
    // one-time migration from the single-user era
    const legacy = await db.doc('system/garminTokens').get()
    if (legacy.exists) {
      const reg = await db.collection('garminUsers').limit(1).get()
      if (reg.empty) {
        const { users } = await getAuth().listUsers(2)
        if (users[0]) {
          await tokensRef(users[0].uid).set(legacy.data())
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
        await syncUser(uid)
      } catch (e) {
        logger.warn(`Sync failed for ${uid}: ${e.message}`)
        await statusRef(uid).set({ lastError: e.message, lastErrorAt: Date.now() }, { merge: true })
      }
    }
  },
)
