// Recipe math + the AI import contract. Pure functions.
import type { Macros, Recipe, RecipeIngredient, RecipeSection } from '../types'

/** totals across all sections; `overrides` maps ingredient id → cooked qty
 *  (scaling an ingredient scales its macros linearly from the stated qty) */
export const recipeTotals = (recipe: Recipe, overrides?: Record<string, number>): Macros => {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  for (const s of recipe.sections) {
    for (const i of s.ingredients) {
      const factor = overrides && overrides[i.id] !== undefined && i.qty > 0 ? overrides[i.id] / i.qty : 1
      t.kcal += (i.kcal ?? 0) * factor
      t.protein += (i.protein ?? 0) * factor
      t.carbs += (i.carbs ?? 0) * factor
      t.fat += (i.fat ?? 0) * factor
    }
  }
  return t
}

export const perPortion = (totals: Macros, portions: number): Macros => {
  const p = Math.max(1, portions)
  return { kcal: totals.kcal / p, protein: totals.protein / p, carbs: totals.carbs / p, fat: totals.fat / p }
}

export const missingMacroCount = (recipe: Recipe): number =>
  recipe.sections.reduce((n, s) => n + s.ingredients.filter((i) => i.kcal == null).length, 0)

const rid = () => crypto.randomUUID()

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null
}

/** validate + normalize anything an AI (or human) pasted */
export function sanitizeRecipe(input: unknown): Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> {
  const r = input as Record<string, unknown>
  if (!r || typeof r !== 'object') throw new Error('Not a recipe object')
  const name = String(r.name ?? '').trim().slice(0, 120)
  if (!name) throw new Error('Recipe needs a name')
  const rawSections = Array.isArray(r.sections) ? r.sections : []
  if (!rawSections.length) throw new Error('Recipe needs at least one section')

  const sections: RecipeSection[] = rawSections.slice(0, 12).map((sec) => {
    const so = sec as Record<string, unknown>
    const ingredients: RecipeIngredient[] = (Array.isArray(so.ingredients) ? so.ingredients : [])
      .slice(0, 60)
      .map((ing) => {
        const io = ing as Record<string, unknown>
        return {
          id: rid(),
          name: String(io.name ?? '').trim().slice(0, 120),
          qty: Math.max(0, Number(io.qty) || 0),
          unit: String(io.unit ?? '').trim().slice(0, 20) || 'unit',
          kcal: num(io.kcal),
          protein: num(io.protein),
          carbs: num(io.carbs),
          fat: num(io.fat),
          ...(io.optional ? { optional: true } : {}),
        }
      })
      .filter((i) => i.name)
    return {
      id: rid(),
      title: String(so.title ?? '').trim().slice(0, 120) || 'Recipe',
      ingredients,
      method: String(so.method ?? '').trim().slice(0, 8000),
    }
  })

  return {
    name,
    emoji: r.emoji ? String(r.emoji).slice(0, 8) : null,
    portions: Math.min(64, Math.max(1, Math.round(Number(r.portions) || 1))),
    sections,
    notes: r.notes ? String(r.notes).slice(0, 2000) : null,
  }
}

/** the prompt users paste into ANY AI to get import-ready JSON back */
export const AI_RECIPE_PROMPT = `Convert the recipe below into a single JSON object with EXACTLY this shape (no markdown, no commentary — output only the JSON):

{
  "name": "Recipe name",
  "emoji": "🥩",
  "portions": 4,
  "notes": "optional serving/build notes",
  "sections": [
    {
      "title": "Component name (use one section per component, e.g. sauce / protein / wrap)",
      "method": "The full method as plain text, steps separated by newlines.",
      "ingredients": [
        { "name": "mutton stewing meat", "qty": 1900, "unit": "g", "kcal": 4900, "protein": 460, "carbs": 0, "fat": 340 },
        { "name": "garlic cloves", "qty": 8, "unit": "cloves", "kcal": 35, "protein": 1.5, "carbs": 8, "fat": 0 }
      ]
    }
  ]
}

Rules:
- qty is a number, unit is a short string (g, kg → convert to g, ml, tbsp, tsp, cloves, tins, unit…).
- kcal/protein/carbs/fat are for the STATED qty (not per 100g). Estimate them as accurately as you can; omit them only if truly unknown.
- Keep every component of the dish in ONE recipe as separate sections, method included.
- portions = how many servings the whole recipe makes.

Recipe:
`
