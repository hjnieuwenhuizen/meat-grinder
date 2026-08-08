// g/ml foods: macros stored per 100. scoop/unit foods: macros stored per 1.
export const UNITS = ['g', 'ml', 'scoop', 'unit']

export const isPer100 = (u) => !u || u === 'g' || u === 'ml'

export const unitOf = (x) => x.unit || 'g'

// entry amount — legacy entries stored `grams`
export const amountOf = (e) => e.amount ?? e.grams ?? null

export const fmtAmount = (e) => {
  const a = amountOf(e)
  if (a == null) return ''
  const u = unitOf(e)
  return isPer100(u) ? `${a}${u}` : `${a} ${u}${a === 1 ? '' : 's'}`
}

export const basisLabel = (food) =>
  isPer100(food.unit) ? `per 100${unitOf(food)}` : `per ${food.unit}`

// scale factor for a given logged amount
export const scaleFor = (food, amount) =>
  isPer100(food.unit) ? amount / 100 : amount
