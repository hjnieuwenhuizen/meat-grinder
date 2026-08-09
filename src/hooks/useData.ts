import { useEffect, useState, useCallback } from 'react'
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc,
  query, orderBy, documentId, startAt, endAt, getDocs,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { todayKey } from '../lib/dates'
import type { DayDoc, Entry, Food, GoalSnapshot, Macros, Settings, Workout } from '../types'

export const DEFAULT_GOALS: Macros = { kcal: 2200, protein: 180, carbs: 200, fat: 70 }

export const DEFAULT_SETTINGS: Settings = {
  trainingEnabled: false,
  rest: DEFAULT_GOALS,
  training: { kcal: 2600, protein: 200, carbs: 260, fat: 75 },
}

const EMPTY_DAY: DayDoc = { training: false, entries: [], workouts: [] }

const settingsRef = (uid: string) => doc(db, 'users', uid, 'meta', 'settings')
const dayRef = (uid: string, key: string) => doc(db, 'users', uid, 'days', key)
const foodsCol = (uid: string) => collection(db, 'users', uid, 'foods')

export const snapshotOf = (s: Settings): GoalSnapshot => ({
  trainingEnabled: s.trainingEnabled,
  rest: s.rest,
  training: s.training,
})

export function useSettings(uid: string) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    return onSnapshot(settingsRef(uid), (snap) => {
      setIsNew(!snap.exists())
      setSettings(snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : DEFAULT_SETTINGS)
    })
  }, [uid])

  const save = useCallback(
    async (next: Settings) => {
      await setDoc(settingsRef(uid), next)
      // new goals apply from TODAY forward — re-stamp today's snapshot,
      // while every past day keeps the goals it was scored against
      await setDoc(dayRef(uid, todayKey()), { goals: snapshotOf(next) }, { merge: true })
    },
    [uid],
  )

  return { settings, save, isNew }
}

export function useDay(uid: string, key: string, settings?: Settings | null) {
  const [day, setDay] = useState<DayDoc | null>(null)

  useEffect(() => {
    setDay(null)
    return onSnapshot(dayRef(uid, key), (snap) => {
      setDay(snap.exists() ? { ...EMPTY_DAY, ...(snap.data() as Partial<DayDoc>) } : EMPTY_DAY)
    })
  }, [uid, key])

  const write = useCallback(
    (next: DayDoc) => {
      // freeze the goals the first time a day is written
      if (!next.goals && settings) next.goals = snapshotOf(settings)
      return setDoc(dayRef(uid, key), next)
    },
    [uid, key, settings],
  )

  // callers only run these once day is loaded; the assertion keeps call sites clean
  const loaded = () => day as DayDoc

  const addEntry = (entry: Entry) =>
    write({ ...loaded(), entries: [...loaded().entries, entry] })

  const removeEntry = (id: string) =>
    write({ ...loaded(), entries: loaded().entries.filter((e) => e.id !== id) })

  const updateEntry = (id: string, next: Partial<Entry>) =>
    write({ ...loaded(), entries: loaded().entries.map((e) => (e.id === id ? { ...e, ...next } : e)) })

  const setTraining = (training: boolean) => write({ ...loaded(), training })

  const setSleep = (sleep: number | null) => write({ ...loaded(), sleep })

  const setSteps = (steps: number | null) => write({ ...loaded(), steps })

  // extra lets callers atomically flip the training flag with the same write
  const addWorkout = (w: Workout, extra: Partial<DayDoc> = {}) =>
    write({ ...loaded(), ...extra, workouts: [...loaded().workouts, w] })

  const updateWorkout = (id: string, next: Partial<Workout>) =>
    write({ ...loaded(), workouts: loaded().workouts.map((w) => (w.id === id ? { ...w, ...next } : w)) })

  const removeWorkout = (id: string) =>
    write({ ...loaded(), workouts: loaded().workouts.filter((w) => w.id !== id) })

  return { day, addEntry, removeEntry, updateEntry, setTraining, setSleep, setSteps, addWorkout, updateWorkout, removeWorkout }
}

export function useFoods(uid: string) {
  const [foods, setFoods] = useState<Food[]>([])

  useEffect(() => {
    return onSnapshot(query(foodsCol(uid), orderBy('name')), (snap) => {
      setFoods(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Food))
    })
  }, [uid])

  const addFood = (food: Omit<Food, 'id'>) => setDoc(doc(foodsCol(uid)), food)
  const updateFood = (id: string, food: Partial<Food>) => updateDoc(doc(foodsCol(uid), id), food)
  const deleteFood = (id: string) => deleteDoc(doc(foodsCol(uid), id))

  return { foods, addFood, updateFood, deleteFood }
}

export type FoodsApi = ReturnType<typeof useFoods>

// One-shot fetch of day docs between two date keys (inclusive)
export async function fetchDays(uid: string, startKey: string, endKey: string) {
  const q = query(
    collection(db, 'users', uid, 'days'),
    orderBy(documentId()),
    startAt(startKey),
    endAt(endKey),
  )
  const snap = await getDocs(q)
  const byKey: Record<string, DayDoc> = {}
  snap.docs.forEach((d) => { byKey[d.id] = { ...EMPTY_DAY, ...(d.data() as Partial<DayDoc>) } })
  return byKey
}

export const totalsOf = (day: Pick<DayDoc, 'entries'> | null | undefined): Macros =>
  (day?.entries ?? []).reduce(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      protein: t.protein + e.protein,
      carbs: t.carbs + e.carbs,
      fat: t.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

// the day's frozen snapshot wins; live settings only cover legacy days
export const goalFor = (settings: Settings, day: Pick<DayDoc, 'training' | 'goals'> | null | undefined): Macros => {
  const src = day?.goals ?? settings
  return src.trainingEnabled && day?.training ? src.training : src.rest
}
