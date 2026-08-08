import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../lib/firebase'
import type { McpConfig } from '../types'

export function useMcp(uid: string) {
  const [config, setConfig] = useState<McpConfig | null | undefined>(undefined)

  useEffect(() => {
    return onSnapshot(doc(db, 'users', uid, 'meta', 'mcp'), (snap) => {
      setConfig(snap.exists() ? (snap.data() as McpConfig) : null)
    })
  }, [uid])

  return {
    config,
    generate: () => httpsCallable(functions, 'mcpKeyGenerate')({}),
    revoke: () => httpsCallable(functions, 'mcpKeyRevoke')({}),
  }
}
