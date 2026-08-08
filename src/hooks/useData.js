import { useEffect, useState, useCallback } from 'react'
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc,
  query, orderBy, documentId, startAt, endAt, getDocs,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export const DEFAULT_GOALS = { kcal: 2200, protein: 180, carbs: 200, fat: 70 }

export const DEFAULT_SETTINGS = {
  trainingEnabled: false,
  rest: DEFAULT_GOALS,
  training: { kcal: 2600, protein: 200, carbs: 260, fat: 75 },
}

const settingsRef = (uid) => doc(db, 'users', uid, 'meta', 'settings')
const dayRef = (uid, key) => doc(db, 'users', uid, 'days', key)
const foodsCol = (uid) => collection(db, 'users', uid, 'foods')

export function useSettings(uid) {
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    return onSnapshot(settingsRef(uid), (snap) => {
      setSettings(snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : DEFAULT_SETTINGS)
    })
  }, [uid])

  const save = useCallback((next) => setDoc(settingsRef(uid), next), [uid])

  return { settings, save }
}

export function useDay(uid, key) {
  const [day, setDay] = useState(null)

  useEffect(() => {
    setDay(null)
    return onSnapshot(dayRef(uid, key), (snap) => {
      setDay(snap.exists()
        ? { workouts: [], ...snap.data() }
        : { training: false, entries: [], workouts: [] })
    })
  }, [uid, key])

  const write = useCallback(
    (next) => setDoc(dayRef(uid, key), next),
    [uid, key],
  )

  const addEntry = (entry) =>
    write({ ...day, entries: [...day.entries, entry] })

  const removeEntry = (id) =>
    write({ ...day, entries: day.entries.filter((e) => e.id !== id) })

  const updateEntry = (id, next) =>
    write({ ...day, entries: day.entries.map((e) => (e.id === id ? { ...e, ...next } : e)) })

  const setTraining = (training) => write({ ...day, training })

  const setSleep = (sleep) => write({ ...day, sleep })

  // extra lets callers atomically flip the training flag with the same write
  const addWorkout = (w, extra = {}) =>
    write({ ...day, ...extra, workouts: [...day.workouts, w] })

  const updateWorkout = (id, next) =>
    write({ ...day, workouts: day.workouts.map((w) => (w.id === id ? { ...w, ...next } : w)) })

  const removeWorkout = (id) =>
    write({ ...day, workouts: day.workouts.filter((w) => w.id !== id) })

  return { day, addEntry, removeEntry, updateEntry, setTraining, setSleep, addWorkout, updateWorkout, removeWorkout }
}

export function useFoods(uid) {
  const [foods, setFoods] = useState([])

  useEffect(() => {
    return onSnapshot(query(foodsCol(uid), orderBy('name')), (snap) => {
      setFoods(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
  }, [uid])

  const addFood = (food) => setDoc(doc(foodsCol(uid)), food)
  const updateFood = (id, food) => updateDoc(doc(foodsCol(uid), id), food)
  const deleteFood = (id) => deleteDoc(doc(foodsCol(uid), id))

  return { foods, addFood, updateFood, deleteFood }
}

// One-shot fetch of day docs between two date keys (inclusive)
export async function fetchDays(uid, startKey, endKey) {
  const q = query(
    collection(db, 'users', uid, 'days'),
    orderBy(documentId()),
    startAt(startKey),
    endAt(endKey),
  )
  const snap = await getDocs(q)
  const byKey = {}
  snap.docs.forEach((d) => { byKey[d.id] = d.data() })
  return byKey
}

export const totalsOf = (day) =>
  (day?.entries ?? []).reduce(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      protein: t.protein + e.protein,
      carbs: t.carbs + e.carbs,
      fat: t.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

export const goalFor = (settings, day) =>
  settings.trainingEnabled && day?.training ? settings.training : settings.rest
