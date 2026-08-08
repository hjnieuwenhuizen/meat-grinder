import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../lib/firebase'
import type { GarminStatus } from '../types'

interface GarminResult {
  ok: boolean
  summary?: string
}

const call = <T = Record<string, unknown>>(name: string) =>
  httpsCallable<T, GarminResult>(functions, name)

export function useGarmin(uid: string) {
  const [status, setStatus] = useState<GarminStatus | null>(null)

  useEffect(() => {
    return onSnapshot(doc(db, 'users', uid, 'meta', 'garmin'), (snap) => {
      setStatus(snap.exists() ? (snap.data() as GarminStatus) : { connected: false })
    })
  }, [uid])

  return {
    status,
    connect: (email: string, password: string) => call('garminConnect')({ email, password }),
    connectTokens: (tokens: unknown) => call('garminConnect')({ tokens }),
    syncNow: () => call('garminSyncUser')({}),
    disconnect: () => call('garminDisconnect')({}),
  }
}
