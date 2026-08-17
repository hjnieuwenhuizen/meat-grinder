// Shared exercise library — self-building: every saved set upserts its
// exercise (slug-keyed, so the same movement never duplicates).
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, orderBy, query, setDoc, increment } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Exercise } from '../types'

export const exerciseSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)

export function useExercises() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  useEffect(() => {
    return onSnapshot(query(collection(db, 'exercises'), orderBy('name')), (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as Omit<Exercise, 'id'>), id: d.id }))
      // frecency: most-used first, then most recent
      list.sort((a, b) => (b.used ?? 0) - (a.used ?? 0) || (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
      setExercises(list)
    })
  }, [])
  return exercises
}

/** bump/create the used exercises after a workout save */
export async function bumpExercises(names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  await Promise.all(
    unique.map((name) =>
      setDoc(
        doc(db, 'exercises', exerciseSlug(name)),
        { name, used: increment(1), lastUsed: Date.now() },
        { merge: true },
      ),
    ),
  )
}
