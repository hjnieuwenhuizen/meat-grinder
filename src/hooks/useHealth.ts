// Phone health sync (Samsung Health / any app feeding Health Connect on
// Android; Apple Health once an iOS shell exists). Native shell only — on the
// plain web build every export is a safe no-op.
import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Health } from 'capacitor-health'
import { doc, setDoc } from 'firebase/firestore'
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

  const { aggregatedData } = await Health.queryAggregated({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    dataType: 'steps',
    bucket: 'day',
  })

  let wrote = 0
  for (const sample of aggregatedData ?? []) {
    const steps = Math.round(sample.value)
    if (!steps || steps <= 0) continue
    const key = keyOf(new Date(sample.startDate))
    await setDoc(doc(db, 'users', uid, 'days', key), { steps }, { merge: true })
    wrote++
  }
  return wrote ? `synced steps for ${wrote} day${wrote > 1 ? 's' : ''}` : 'no step data found'
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
  void syncHealthSteps(uid).catch(() => {})
}
