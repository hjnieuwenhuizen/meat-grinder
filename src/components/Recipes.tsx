// The recipe box: sectioned recipes with per-ingredient macros, live scaling
// when cooking, per-portion math, shopping lists, and AI-assisted import.
import { useMemo, useState } from 'react'
import { recipeTotals, perPortion, missingMacroCount, sanitizeRecipe, AI_RECIPE_PROMPT } from '../lib/recipes'
import { logPortion, type RecipesApi } from '../hooks/useRecipes'
import { CopyButton, Modal, Field, Panel, Plus, Trash, Pencil } from './ui'
import type { Macros, Recipe, RecipeIngredient, RecipeSection, Settings } from '../types'

const rid = () => crypto.randomUUID()
const fmt = (m: Macros) =>
  `${Math.round(m.kcal)} kcal · P ${Math.round(m.protein)} · C ${Math.round(m.carbs)} · F ${Math.round(m.fat)}`

export default function Recipes({ uid, settings, api }: { uid: string; settings: Settings; api: RecipesApi }) {
  const { recipes, addRecipe, updateRecipe, deleteRecipe } = api
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<Recipe | null>(null)
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const filtered = useMemo(
    () => recipes.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [recipes, search],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search recipes…"
          className="w-full max-w-xs rounded-full border border-edge bg-panel px-4 py-2 text-base outline-none transition focus:border-grind/60 sm:text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={AI_RECIPE_PROMPT} label="Copy AI prompt" />
          <button
            onClick={() => setImporting(true)}
            className="rounded-full border border-grind/50 px-4 py-1.5 text-sm font-semibold text-grind transition hover:bg-grind-soft"
          >
            Import JSON
          </button>
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 rounded-full bg-grind px-4 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            <Plus className="size-4" /> New recipe
          </button>
        </div>
      </div>
      <p className="text-[11px] text-mist">
        No custom GPT? <b className="text-bone">Copy AI prompt</b>, paste it plus your recipe into any AI, then <b className="text-bone">Import JSON</b> with what it returns.
      </p>

      {filtered.length === 0 && (
        <Panel className="p-8 text-center text-sm text-mist">
          {recipes.length === 0 ? 'No recipes yet. Add your favourites — every component in one place.' : 'No match.'}
        </Panel>
      )}
      <div className="grid gap-2 lg:grid-cols-2">
        {filtered.map((r) => {
          const totals = recipeTotals(r)
          const missing = missingMacroCount(r)
          return (
            <div key={r.id} className="group flex items-center justify-between rounded-xl border border-edge bg-panel px-4 py-3">
              <button onClick={() => setViewing(r)} className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium">{r.emoji ? `${r.emoji} ` : ''}{r.name}</div>
                <div className="mt-0.5 text-xs text-mist">
                  {r.portions} portion{r.portions > 1 ? 's' : ''}
                  {totals.kcal > 0 ? ` · ${fmt(perPortion(totals, r.portions))} each` : ''}
                  {missing > 0 && <span className="text-carbs"> · {missing} ingredient{missing > 1 ? 's' : ''} missing macros</span>}
                </div>
              </button>
              <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <button onClick={() => setEditing(r)} className="p-1.5 text-mist hover:text-bone"><Pencil className="size-4" /></button>
                <button onClick={() => deleteRecipe(r.id)} className="p-1.5 text-mist hover:text-over"><Trash className="size-4" /></button>
              </div>
            </div>
          )
        })}
      </div>

      {viewing && (
        <RecipeView
          recipe={recipes.find((r) => r.id === viewing.id) ?? viewing}
          uid={uid}
          settings={settings}
          onEdit={() => { setEditing(viewing); setViewing(null) }}
          onClose={() => setViewing(null)}
        />
      )}
      {editing && (
        <RecipeForm
          initial={editing === 'new' ? null : editing}
          onSave={(data) => {
            if (editing === 'new') void addRecipe(data)
            else void updateRecipe(editing.id, data)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <ImportModal
          onImport={(data) => { void addRecipe(data); setImporting(false) }}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}

/* ---------- view: Recipe | Cook | Shopping ---------- */

function RecipeView({ recipe, uid, settings, onEdit, onClose }: {
  recipe: Recipe
  uid: string
  settings: Settings
  onEdit: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'recipe' | 'cook' | 'shopping'>('recipe')
  const TABS: [typeof tab, string][] = [['recipe', 'Recipe'], ['cook', 'Cook'], ['shopping', 'Shopping']]
  const totals = recipeTotals(recipe)

  return (
    <Modal title={`${recipe.emoji ? `${recipe.emoji} ` : ''}${recipe.name}`} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-1 gap-1 rounded-full border border-edge bg-ink p-1">
          {TABS.map(([t, label]) => (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${tab === t ? 'bg-raise text-bone' : 'text-mist'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onEdit} className="p-1.5 text-mist hover:text-bone" title="Edit recipe">
          <Pencil className="size-4" />
        </button>
      </div>

      {tab === 'recipe' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-edge bg-ink p-3 text-xs text-mist">
            Makes <b className="text-bone">{recipe.portions}</b> portion{recipe.portions > 1 ? 's' : ''}
            {totals.kcal > 0 && (
              <>
                {' '}· whole dish {fmt(totals)}
                <div className="mt-0.5">per portion: <b className="text-grind">{fmt(perPortion(totals, recipe.portions))}</b></div>
              </>
            )}
          </div>
          {recipe.sections.map((s) => (
            <div key={s.id}>
              <h3 className="mb-1.5 text-sm font-semibold text-grind">{s.title}</h3>
              <ul className="mb-2 space-y-0.5 text-sm">
                {s.ingredients.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>{i.qty > 0 ? `${i.qty} ${i.unit} ` : ''}{i.name}{i.optional ? <span className="text-mist"> (optional)</span> : ''}</span>
                    {i.kcal != null && <span className="shrink-0 text-xs text-mist">{Math.round(i.kcal)} kcal</span>}
                  </li>
                ))}
              </ul>
              {s.method && <p className="whitespace-pre-line text-xs leading-relaxed text-mist">{s.method}</p>}
            </div>
          ))}
          {recipe.notes && <p className="whitespace-pre-line rounded-lg border border-edge bg-ink p-3 text-xs text-mist">{recipe.notes}</p>}
        </div>
      )}

      {tab === 'cook' && <CookTab recipe={recipe} uid={uid} settings={settings} />}
      {tab === 'shopping' && <ShoppingTab recipe={recipe} />}
    </Modal>
  )
}

// live scaling: tweak what actually went in the pot + how many portions it made
function CookTab({ recipe, uid, settings }: { recipe: Recipe; uid: string; settings: Settings }) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [portions, setPortions] = useState(recipe.portions)
  const [logged, setLogged] = useState(false)

  const totals = recipeTotals(recipe, overrides)
  const per = perPortion(totals, portions)

  return (
    <div className="space-y-3">
      <p className="text-xs text-mist">Cooked it differently? Adjust the amounts that actually went in — the dish and per-portion macros rescale live.</p>
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {recipe.sections.map((s) => (
          <div key={s.id}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-grind/80">{s.title}</div>
            {s.ingredients.map((i) => (
              <div key={i.id} className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number" inputMode="decimal" min="0"
                    value={overrides[i.id] ?? i.qty}
                    onChange={(e) => setOverrides({ ...overrides, [i.id]: Math.max(0, Number(e.target.value) || 0) })}
                    className={`w-20 rounded-lg border bg-ink px-2 py-1 text-right text-sm outline-none ${overrides[i.id] !== undefined && overrides[i.id] !== i.qty ? 'border-grind/60 text-grind' : 'border-edge text-bone'}`}
                  />
                  <span className="w-12 text-xs text-mist">{i.unit}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <label className="flex items-center justify-between rounded-xl border border-edge bg-ink p-3 text-sm">
        <span>Portions it made</span>
        <input
          type="number" min={1} max={64} value={portions}
          onChange={(e) => setPortions(Math.max(1, Math.min(64, Math.round(Number(e.target.value) || 1))))}
          className="w-16 rounded-lg border border-edge bg-panel px-2 py-1 text-center text-bone outline-none"
        />
      </label>
      <div className="rounded-xl border border-grind/40 bg-grind-soft/30 p-3 text-sm">
        <div>Whole dish: <b className="tabular-nums">{fmt(totals)}</b></div>
        <div>Per portion: <b className="tabular-nums text-grind">{fmt(per)}</b></div>
      </div>
      <button
        type="button"
        disabled={totals.kcal <= 0 || logged}
        onClick={async () => {
          await logPortion(uid, settings, recipe.name, per)
          setLogged(true)
          setTimeout(() => setLogged(false), 2000)
        }}
        className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
      >
        {logged ? 'Logged ✓' : 'Log 1 portion to today'}
      </button>
    </div>
  )
}

function ShoppingTab({ recipe }: { recipe: Recipe }) {
  const all = useMemo(() => recipe.sections.flatMap((s) => s.ingredients), [recipe])
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(all.map((i) => [i.id, true])),
  )
  const list = all.filter((i) => picked[i.id])
  const copyText = () =>
    [`Shopping list — ${recipe.name}`, ...list.map((i) => `- ${i.qty > 0 ? `${i.qty} ${i.unit} ` : ''}${i.name}`)].join('\n')

  return (
    <div className="space-y-3">
      <p className="text-xs text-mist">Untick what you already have, then copy.</p>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {all.map((i) => (
          <label key={i.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm">
            <input
              type="checkbox"
              checked={picked[i.id] ?? true}
              onChange={(e) => setPicked({ ...picked, [i.id]: e.target.checked })}
              className="size-4 accent-(--color-grind)"
            />
            <span className={picked[i.id] ? '' : 'text-mist line-through'}>
              {i.qty > 0 ? `${i.qty} ${i.unit} ` : ''}{i.name}
            </span>
          </label>
        ))}
      </div>
      <CopyButton text={copyText} label={`Copy shopping list (${list.length})`} />
    </div>
  )
}

/* ---------- editor ---------- */

const emptyIngredient = (): RecipeIngredient => ({ id: rid(), name: '', qty: 0, unit: 'g', kcal: null, protein: null, carbs: null, fat: null })
const emptySection = (): RecipeSection => ({ id: rid(), title: '', ingredients: [emptyIngredient()], method: '' })

function RecipeForm({ initial, onSave, onClose }: {
  initial: Recipe | null
  onSave: (data: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '')
  const [portions, setPortions] = useState(initial?.portions ?? 4)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [sections, setSections] = useState<RecipeSection[]>(
    initial?.sections?.length ? initial.sections.map((s) => ({ ...s, ingredients: s.ingredients.map((i) => ({ ...i })) })) : [emptySection()],
  )

  const setSection = (id: string, patch: Partial<RecipeSection>) =>
    setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const setIng = (sid: string, iid: string, patch: Partial<RecipeIngredient>) =>
    setSections(sections.map((s) =>
      s.id === sid ? { ...s, ingredients: s.ingredients.map((i) => (i.id === iid ? { ...i, ...patch } : i)) } : s,
    ))

  const valid = name.trim().length > 0 && sections.some((s) => s.ingredients.some((i) => i.name.trim()))

  return (
    <Modal title={initial ? 'Edit recipe' : 'New recipe'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onSave({
            name: name.trim(),
            emoji: emoji.trim() || null,
            portions,
            notes: notes.trim() || null,
            sections: sections
              .map((s) => ({ ...s, title: s.title.trim() || 'Recipe', ingredients: s.ingredients.filter((i) => i.name.trim()) }))
              .filter((s) => s.ingredients.length || s.method.trim()),
          })
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-[1fr_70px_90px] gap-2">
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Greek Mutton Gyros" autoFocus />
          <Field label="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🥩" />
          <Field label="Portions" type="number" inputMode="numeric" value={portions} onChange={(e) => setPortions(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </div>

        {sections.map((s, si) => (
          <div key={s.id} className="rounded-xl border border-edge bg-ink p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                value={s.title}
                onChange={(e) => setSection(s.id, { title: e.target.value })}
                placeholder={`Component ${si + 1} — e.g. Tzatziki`}
                className="min-w-0 flex-1 rounded-lg border border-edge bg-panel px-3 py-1.5 text-sm font-medium text-bone outline-none focus:border-grind/60"
              />
              {sections.length > 1 && (
                <button type="button" onClick={() => setSections(sections.filter((x) => x.id !== s.id))} className="p-1 text-mist hover:text-over">
                  <Trash className="size-4" />
                </button>
              )}
            </div>
            <div className="mb-1 grid grid-cols-[1fr_54px_54px_46px_40px_40px_40px_24px] gap-1 text-[9px] uppercase tracking-wider text-mist">
              <span>Ingredient</span><span>Qty</span><span>Unit</span><span>kcal</span><span>P</span><span>C</span><span>F</span><span />
            </div>
            {s.ingredients.map((i) => (
              <div key={i.id} className="mb-1 grid grid-cols-[1fr_54px_54px_46px_40px_40px_40px_24px] gap-1">
                <input value={i.name} onChange={(e) => setIng(s.id, i.id, { name: e.target.value })} placeholder="mutton" className="min-w-0 rounded border border-edge bg-panel px-2 py-1 text-xs text-bone outline-none focus:border-grind/60" />
                <input type="number" inputMode="decimal" value={i.qty || ''} onChange={(e) => setIng(s.id, i.id, { qty: Math.max(0, Number(e.target.value) || 0) })} className="rounded border border-edge bg-panel px-1 py-1 text-right text-xs text-bone outline-none" />
                <input value={i.unit} onChange={(e) => setIng(s.id, i.id, { unit: e.target.value })} className="rounded border border-edge bg-panel px-1 py-1 text-xs text-bone outline-none" />
                {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
                  <input
                    key={k} type="number" inputMode="decimal" placeholder="–"
                    value={i[k] ?? ''}
                    onChange={(e) => setIng(s.id, i.id, { [k]: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
                    className="rounded border border-edge bg-panel px-1 py-1 text-right text-xs text-bone outline-none"
                  />
                ))}
                <button type="button" onClick={() => setSection(s.id, { ingredients: s.ingredients.filter((x) => x.id !== i.id) })} className="text-mist hover:text-over">×</button>
              </div>
            ))}
            <button type="button" onClick={() => setSection(s.id, { ingredients: [...s.ingredients, emptyIngredient()] })} className="mb-2 text-xs text-grind hover:underline">
              + ingredient
            </button>
            <textarea
              value={s.method}
              onChange={(e) => setSection(s.id, { method: e.target.value })}
              rows={3}
              placeholder="Method for this component…"
              className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-xs text-bone outline-none focus:border-grind/60"
            />
          </div>
        ))}
        <button type="button" onClick={() => setSections([...sections, emptySection()])} className="text-sm text-grind hover:underline">
          + add component
        </button>

        <textarea
          value={notes ?? ''}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Serving / build notes (optional)…"
          className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-xs text-bone outline-none focus:border-grind/60"
        />
        <p className="text-[10px] text-mist">Macros are per stated quantity (not per 100g) — leave blank if unknown; your AI can fill them in later via updateRecipe.</p>
        <button type="submit" disabled={!valid} className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40">
          Save recipe
        </button>
      </form>
    </Modal>
  )
}

function ImportModal({ onImport, onClose }: {
  onImport: (data: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}) {
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal title="Import recipe JSON" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-mist">
          Paste the JSON an AI produced from the <b className="text-bone">Copy AI prompt</b> template.
        </p>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={10}
          placeholder='{"name": "...", "portions": 4, "sections": [...]}'
          className="w-full rounded-lg border border-edge bg-ink px-3 py-2 font-mono text-xs text-bone outline-none focus:border-grind/60"
        />
        {error && <p className="text-xs text-over">{error}</p>}
        <button
          type="button" disabled={!json.trim()}
          onClick={() => {
            try {
              // tolerate markdown fences from chatty AIs
              const clean = json.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
              onImport(sanitizeRecipe(JSON.parse(clean)))
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Invalid JSON')
            }
          }}
          className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Import
        </button>
      </div>
    </Modal>
  )
}
