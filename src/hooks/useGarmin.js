import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../lib/firebase'

const call = (name) => httpsCallable(functions, name)

export function useGarmin(uid) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    return onSnapshot(doc(db, 'users', uid, 'meta', 'garmin'), (snap) => {
      setStatus(snap.exists() ? snap.data() : { connected: false })
    })
  }, [uid])

  return {
    status,
    connect: (email, password) => call('garminConnect')({ email, password }),
    connectTokens: (tokens) => call('garminConnect')({ tokens }),
    syncNow: () => call('garminSyncUser')(),
    disconnect: () => call('garminDisconnect')(),
  }
}
