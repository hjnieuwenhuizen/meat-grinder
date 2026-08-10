// Phone health sync (Samsung Health / any app feeding Health Connect on
// Android; Apple Health once an iOS shell exists). Native shell only — on the
// plain web build every export is a safe no-op.
import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Health } from 'capacitor-health'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { keyOf, todayKey, addDays, fromKey } from '../lib/dates'

export const isNativeApp = () => Capacitor.isNativePlatform()

const ENABLED_FLAG = 'healthSyncEnabled'

/** pull daily step totals for the last `days` days and write them to the diary */
export async function syncHealthSteps(uid: string, days = 2): Promise<string> {
  if (!isNativeApp()) return 'not running in the app'
  const { available } = await Health.isHealthAvailable()
  if (!available) return 'Health Connect is not available on this phone'

  const start = fromKey(addDays(todayKey(), -(days - 1)))
  start.setHours(0, 0, 0, 0)
  const end = new Date()

  const perm = await Health.checkHealthPermissions({ permissions: ['READ_STEPS'] }).catch(() => null)

  const { aggregatedData } = await Health.queryAggregated({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    dataType: 'steps',
    bucket: 'day',
  })

  // daily totals via aggregation; buckets can come back valueless (null →
  // NaN over the bridge), so guard and fall back to raw records
  const byDay: Record<string, number> = {}
  for (const sample of aggregatedData ?? []) {
    const v = Number(sample.value)
    if (Number.isFinite(v) && v > 0) byDay[keyOf(new Date(sample.startDate))] = Math.round(v)
  }
  let mode = 'aggregate'
  if (!Object.keys(byDay).length) {
    mode = 'records'
    const { records } = await Health.queryRecords({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      dataType: 'steps',
    })
    for (const r of records ?? []) {
      const v = Number(r.value)
      if (!Number.isFinite(v) || v <= 0) continue
      const key = keyOf(new Date(r.startDate))
      byDay[key] = (byDay[key] ?? 0) + Math.round(v)
    }
  }

  let wrote = 0
  const daysLog: { key: string; steps: number }[] = []
  for (const [key, steps] of Object.entries(byDay)) {
    daysLog.push({ key, steps })
    // own lane: never touches the manual `steps` field or Garmin's count
    await setDoc(doc(db, 'users', uid, 'days', key), { health: { steps } }, { merge: true })
    wrote++
  }
  const result = wrote
    ? `synced steps for ${wrote} day${wrote > 1 ? 's' : ''} (${mode})`
    : `no step data in Health Connect — check the Health Connect app: is Samsung Health/Google Fit listed under App permissions and syncing steps?`
  await pushHealthLog(uid, {
    at: Date.now(), result, mode,
    permission: perm ? JSON.stringify(perm) : 'check failed',
    aggBuckets: aggregatedData?.length ?? 0,
    days: daysLog,
  })
  return result
}

// visible sync trail (last 20 runs) at users/{uid}/meta/healthLog
async function pushHealthLog(uid: string, entry: Record<string, unknown>) {
  try {
    const ref = doc(db, 'users', uid, 'meta', 'healthLog')
    const prev = ((await getDoc(ref)).data()?.entries ?? []) as unknown[]
    await setDoc(ref, { entries: [entry, ...prev].slice(0, 20) })
  } catch { /* logging must never break a sync */ }
}

export function useHealth(uid: string) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_FLAG) === '1')

  const connect = async () => {
    setBusy(true)
    setResult(null)
    try {
      const { available } = await Health.isHealthAvailable()
      if (!available) {
        setResult('Health Connect not available — install/update it from the Play Store, then link Samsung Health inside it.')
        return
      }
      await Health.requestHealthPermissions({ permissions: ['READ_STEPS'] })
      localStorage.setItem(ENABLED_FLAG, '1')
      setEnabled(true)
      setResult(await syncHealthSteps(uid, 7))
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const sync = async () => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await syncHealthSteps(uid, 7))
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const disable = () => {
    localStorage.removeItem(ENABLED_FLAG)
    setEnabled(false)
    setResult('Disabled')
  }

  return { native: isNativeApp(), busy, result, enabled, connect, sync, disable }
}

/** fire-and-forget auto sync — call once on app start */
export function autoSyncHealth(uid: string) {
  if (!isNativeApp() || localStorage.getItem(ENABLED_FLAG) !== '1') return
  // a week's backfill so skipped days can't lose steps
  void syncHealthSteps(uid, 7).catch((e) =>
    pushHealthLog(uid, { at: Date.now(), error: e instanceof Error ? e.message : String(e) }),
  )
}
