import { useEffect, useState, useCallback } from 'react'
import {
  collection, doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField,
  query, where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { startOfWeek, todayKey, addDays } from '../lib/dates'
import { fetchDays } from './useData'
import { scoreDay } from '../lib/score'
import type { ChallengeDoc, FamilyDoc, FamilyMember, ScoreDoc, Settings } from '../types'

// no confusable chars (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('')

const famRef = (code: string) => doc(db, 'families', code)
const pointerRef = (uid: string) => doc(db, 'users', uid, 'meta', 'family')
const globalUserRef = (uid: string) => doc(db, 'globalUsers', uid)
const scoreId = (uid: string, date: string) => `${uid}_${date}`

export function useFamily(uid: string) {
  // undefined = loading, null = not in a family
  const [code, setCode] = useState<string | null | undefined>(undefined)
  const [global, setGlobal] = useState(false)
  const [family, setFamily] = useState<FamilyDoc | null>(null)
  const [scores, setScores] = useState<ScoreDoc[]>([])
  const [globalMembers, setGlobalMembers] = useState<Record<string, FamilyMember>>({})
  const [globalScores, setGlobalScores] = useState<ScoreDoc[]>([])
  const [challenges, setChallenges] = useState<ChallengeDoc[]>([])

  useEffect(() => {
    return onSnapshot(pointerRef(uid), (snap) => {
      const data = snap.exists() ? snap.data() : {}
      setCode((data.code as string) ?? null)
      setGlobal(Boolean(data.global))
    })
  }, [uid])

  useEffect(() => {
    if (!code) { setFamily(null); return }
    return onSnapshot(famRef(code), (snap) => {
      setFamily(snap.exists() ? (snap.data() as FamilyDoc) : null)
    })
  }, [code])

  // this week's scores for the whole family
  useEffect(() => {
    if (!code) { setScores([]); return }
    const q = query(collection(famRef(code), 'scores'), where('date', '>=', startOfWeek(todayKey())))
    return onSnapshot(q, (snap) => {
      setScores(snap.docs.map((d) => d.data() as ScoreDoc))
    })
  }, [code])

  // the family's challenges
  useEffect(() => {
    if (!code) { setChallenges([]); return }
    return onSnapshot(collection(famRef(code), 'challenges'), (snap) => {
      setChallenges(snap.docs.map((d) => ({ ...(d.data() as Omit<ChallengeDoc, 'id'>), id: d.id })))
    })
  }, [code])

  // global leaderboard: everyone who opted in + this week's scores
  useEffect(() => {
    if (!global) { setGlobalMembers({}); setGlobalScores([]); return }
    const unsubUsers = onSnapshot(collection(db, 'globalUsers'), (snap) => {
      const members: Record<string, FamilyMember> = {}
      snap.docs.forEach((d) => { members[d.id] = d.data() as FamilyMember })
      setGlobalMembers(members)
    })
    const q = query(collection(db, 'globalScores'), where('date', '>=', startOfWeek(todayKey())))
    const unsubScores = onSnapshot(q, (snap) => {
      setGlobalScores(snap.docs.map((d) => d.data() as ScoreDoc))
    })
    return () => { unsubUsers(); unsubScores() }
  }, [global])

  const create = useCallback(async (name: string, member: FamilyMember) => {
    const c = newCode()
    const fam: FamilyDoc = { name: name.trim() || 'Family', members: { [uid]: member }, createdAt: Date.now() }
    await setDoc(famRef(c), fam)
    await setDoc(pointerRef(uid), { code: c }, { merge: true })
    return c
  }, [uid])

  const join = useCallback(async (rawCode: string, member: FamilyMember) => {
    const c = rawCode.trim().toUpperCase()
    const snap = await getDoc(famRef(c))
    if (!snap.exists()) throw new Error('No family with that code')
    await updateDoc(famRef(c), { [`members.${uid}`]: member })
    await setDoc(pointerRef(uid), { code: c }, { merge: true })
  }, [uid])

  const leave = useCallback(async () => {
    if (!code) return
    await updateDoc(famRef(code), { [`members.${uid}`]: deleteField() })
    await setDoc(pointerRef(uid), { code: deleteField() }, { merge: true })
  }, [uid, code])

  const joinGlobal = useCallback(async (member: FamilyMember) => {
    await setDoc(globalUserRef(uid), member)
    await setDoc(pointerRef(uid), { global: true }, { merge: true })
  }, [uid])

  const leaveGlobal = useCallback(async () => {
    await deleteDoc(globalUserRef(uid))
    await setDoc(pointerRef(uid), { global: false }, { merge: true })
  }, [uid])

  const addChallenge = useCallback(async (c: Omit<ChallengeDoc, 'id' | 'createdBy' | 'createdAt'>) => {
    if (!code) return
    await setDoc(doc(collection(famRef(code), 'challenges')), { ...c, createdBy: uid, createdAt: Date.now() })
  }, [uid, code])

  const removeChallenge = useCallback(async (id: string) => {
    if (!code) return
    await deleteDoc(doc(famRef(code), 'challenges', id))
  }, [code])

  const setPhoto = useCallback(async (photo: string) => {
    if (code) await updateDoc(famRef(code), { [`members.${uid}.photo`]: photo })
    if (global) await updateDoc(globalUserRef(uid), { photo })
  }, [uid, code, global])

  return {
    code, family, scores, create, join, leave, setPhoto,
    global, globalMembers, globalScores, joinGlobal, leaveGlobal,
    challenges, addChallenge, removeChallenge,
  }
}

export type FamilyApi = ReturnType<typeof useFamily>

/** where to publish daily scores — family and/or global */
export interface PublishTargets {
  code: string | null
  global: boolean
}

/** one-shot fetch of a family's score docs in a date range (for challenges) */
export async function fetchChallengeScores(code: string, start: string, end: string): Promise<ScoreDoc[]> {
  const q = query(
    collection(famRef(code), 'scores'),
    where('date', '>=', start),
    where('date', '<=', end),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => d.data() as ScoreDoc)
}

/**
 * Re-publish the last 3 days on app start, so scores stay accurate even when
 * Garmin steps land after the day was last on screen. Idempotent writes.
 */
export function useScoreBackfill(uid: string, settings: Settings | null, targets: PublishTargets) {
  useEffect(() => {
    if (!settings || (!targets.code && !targets.global)) return
    const today = todayKey()
    void fetchDays(uid, addDays(today, -2), today)
      .then((byKey) =>
        Promise.all(Object.entries(byKey).map(([date, day]) =>
          publishScore(targets, uid, date, scoreDay(day, settings)),
        )),
      )
      .catch(() => {})
  }, [uid, settings, targets])
}

/** publish a day's score summary — called from the diary after edits */
export async function publishScore(
  targets: PublishTargets, uid: string, date: string,
  score: { points: number; steps: number; breakdown: ScoreDoc['breakdown'] },
) {
  const docData: ScoreDoc = { uid, date, ...score, updatedAt: Date.now() }
  const writes: Promise<void>[] = []
  if (targets.code) writes.push(setDoc(doc(famRef(targets.code), 'scores', scoreId(uid, date)), docData))
  if (targets.global) writes.push(setDoc(doc(db, 'globalScores', scoreId(uid, date)), docData))
  await Promise.all(writes)
}
