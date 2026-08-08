import type { Entry, Food, Unit } from '../types'

// g/ml foods: macros stored per 100. scoop/unit foods: macros stored per 1.
export const UNITS: Unit[] = ['g', 'ml', 'scoop', 'unit']

export const isPer100 = (u?: Unit | null): boolean => !u || u === 'g' || u === 'ml'

export const unitOf = (x: { unit?: Unit | null }): Unit => x.unit || 'g'

// entry amount — legacy entries stored `grams`
export const amountOf = (e: Pick<Entry, 'amount' | 'grams'>): number | null =>
  e.amount ?? e.grams ?? null

export const fmtAmount = (e: Pick<Entry, 'amount' | 'grams' | 'unit'>): string => {
  const a = amountOf(e)
  if (a == null) return ''
  const u = unitOf(e)
  return isPer100(u) ? `${a}${u}` : `${a} ${u}${a === 1 ? '' : 's'}`
}

export const basisLabel = (food: Pick<Food, 'unit'>): string =>
  isPer100(food.unit) ? `per 100${unitOf(food)}` : `per ${food.unit}`

// scale factor for a given logged amount
export const scaleFor = (food: Pick<Food, 'unit'>, amount: number): number =>
  isPer100(food.unit) ? amount / 100 : amount
