// App-open / refocus data refresh with a tiny shared "syncing" store so the
// Diary can show progress. Server throttles real Garmin syncs to 1 per 10 min.
import { useSyncExternalStore } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import { autoSyncHealth } from './useHealth'

let syncing = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function kickSync(uid: string) {
  if (syncing) return
  syncing = true
  emit()
  void Promise.allSettled([
    httpsCallable(functions, 'garminSyncUser')({ ifStale: true }),
    Promise.resolve().then(() => autoSyncHealth(uid)),
  ]).finally(() => {
    syncing = false
    emit()
  })
}

export function useSyncing(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => syncing,
  )
}
