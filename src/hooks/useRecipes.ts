import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, query, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { todayKey } from '../lib/dates'
import { defaultMealNow } from '../lib/meals'
import { snapshotOf } from './useData'
import type { DayDoc, Entry, Macros, Recipe, Settings } from '../types'

// shared library — same collection for every user (legacy personal recipes
// are published into it once by publishLegacyLibrary in useData)
const recipesCol = (_uid: string) => collection(db, 'recipes')

export function useRecipes(uid: string) {
  const [recipes, setRecipes] = useState<Recipe[]>([])

  useEffect(() => {
    return onSnapshot(query(recipesCol(uid), orderBy('name')), (snap) => {
      setRecipes(snap.docs.map((d) => ({ ...(d.data() as Omit<Recipe, 'id'>), id: d.id })))
    })
  }, [uid])

  const addRecipe = async (data: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => {
    const ref = doc(recipesCol(uid))
    await setDoc(ref, { ...data, createdAt: Date.now(), updatedAt: Date.now() })
    return ref.id
  }

  const updateRecipe = (id: string, data: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) =>
    setDoc(doc(recipesCol(uid), id), { ...data, updatedAt: Date.now() }, { merge: true })

  const deleteRecipe = (id: string) => deleteDoc(doc(recipesCol(uid), id))

  return { recipes, addRecipe, updateRecipe, deleteRecipe }
}

export type RecipesApi = ReturnType<typeof useRecipes>

/** log one cooked portion straight into today's diary */
export async function logPortion(uid: string, settings: Settings, recipeName: string, portionMacros: Macros) {
  const key = todayKey()
  const ref = doc(db, 'users', uid, 'days', key)
  const snap = await getDoc(ref)
  const day: DayDoc = { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc> | undefined) }
  const entry: Entry = {
    id: crypto.randomUUID(),
    name: `${recipeName} (1 portion)`,
    amount: 1,
    unit: 'unit',
    meal: defaultMealNow(),
    kcal: Math.round(portionMacros.kcal),
    protein: Math.round(portionMacros.protein * 10) / 10,
    carbs: Math.round(portionMacros.carbs * 10) / 10,
    fat: Math.round(portionMacros.fat * 10) / 10,
  }
  day.entries = [...day.entries, entry]
  if (!day.goals) day.goals = snapshotOf(settings)
  await setDoc(ref, day)
}
