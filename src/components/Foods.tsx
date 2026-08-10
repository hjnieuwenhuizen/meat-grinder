import { useMemo, useState } from 'react'
import { UNITS, isPer100, basisLabel } from '../lib/units'
import { CopyButton, Modal, Field, Panel, Plus, Trash, Pencil } from './ui'
import Recipes from './Recipes'
import { useRecipes } from '../hooks/useRecipes'
import type { FoodsApi } from '../hooks/useData'
import type { Food, Settings } from '../types'

type FoodDraft = Omit<Food, 'id'>

const EMPTY: FoodDraft = { name: '', unit: 'g', alcohol: false, kcal: 0, protein: 0, carbs: 0, fat: 0, serving: null }

export default function Library({ uid, settings, ...foodsApi }: FoodsApi & { uid: string; settings: Settings }) {
  const [view, setView] = useState<'foods' | 'recipes'>('foods')
  const recipesApi = useRecipes(uid)
  const VIEWS: [typeof view, string][] = [['foods', 'Foods'], ['recipes', 'Recipes']]

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full border border-edge bg-panel p-1">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${
              view === v ? 'bg-grind text-ink' : 'text-mist hover:text-bone'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'foods' ? <FoodsList {...foodsApi} /> : <Recipes uid={uid} settings={settings} api={recipesApi} />}
    </div>
  )
}

function FoodsList({ foods, addFood, updateFood, deleteFood }: FoodsApi) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Food | 'new' | null>(null)

  const filtered = useMemo(
    () => foods.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())),
    [foods, search],
  )

  const copyText = () =>
    [
      '# Meat Grinder — My foods',
      ...foods.map((f) => `- ${f.alcohol ? '[Alcohol] ' : ''}${f.name} (${basisLabel(f)}): ${f.kcal} kcal, P ${f.protein}g, C ${f.carbs}g, F ${f.fat}g${f.serving && isPer100(f.unit) ? ` (serving ${f.serving}${f.unit || 'g'})` : ''}`),
    ].join('\n')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search library…"
          className="w-full max-w-xs rounded-full border border-edge bg-panel px-4 py-2 text-base outline-none transition focus:border-grind/60 sm:text-sm"
        />
        <div className="flex items-center gap-2">
          <CopyButton text={copyText} />
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 rounded-full bg-grind px-4 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            <Plus className="size-4" /> New
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <Panel className="p-8 text-center text-sm text-mist">
          {foods.length === 0 ? 'No foods yet. Add your staples — values per 100g.' : 'No match.'}
        </Panel>
      )}
      <div className="grid gap-2 lg:grid-cols-2">
        {filtered.map((f) => (
          <div key={f.id} className="group flex items-center justify-between rounded-xl border border-edge bg-panel px-4 py-3">
            <div>
              <div className={`font-medium ${f.alcohol ? 'text-over' : ''}`}>{f.alcohol ? '🍺 ' : ''}{f.name}</div>
              <div className="mt-0.5 text-xs text-mist">
                {basisLabel(f)}: {f.kcal} kcal · P {f.protein} · C {f.carbs} · F {f.fat}
                {f.alcohol && f.alcoholG ? ` · ${f.alcoholG}g alc` : ''}
                {f.serving && isPer100(f.unit) ? ` · serving ${f.serving}${f.unit || 'g'}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              <button onClick={() => setEditing(f)} className="p-1.5 text-mist hover:text-bone">
                <Pencil className="size-4" />
              </button>
              <button onClick={() => deleteFood(f.id)} className="p-1.5 text-mist hover:text-over">
                <Trash className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <FoodForm
          initial={editing === 'new' ? EMPTY : editing}
          onSave={(data) => {
            if (editing === 'new') addFood(data)
            else updateFood(editing.id, data)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function FoodForm({ initial, onSave, onClose }: {
  initial: FoodDraft
  onSave: (data: FoodDraft) => void
  onClose: () => void
}) {
  const [f, setF] = useState({
    name: initial.name,
    unit: initial.unit || 'g',
    alcohol: !!initial.alcohol,
    alcoholG: initial.alcoholG ? String(initial.alcoholG) : '',
    kcal: initial.kcal ? String(initial.kcal) : '',
    protein: initial.protein ? String(initial.protein) : '',
    carbs: initial.carbs ? String(initial.carbs) : '',
    fat: initial.fat ? String(initial.fat) : '',
    serving: initial.serving ? String(initial.serving) : '',
  })
  const [energyUnit, setEnergyUnit] = useState<'kcal' | 'kJ'>('kcal')
  const set = (k: 'name' | 'alcoholG' | 'kcal' | 'protein' | 'carbs' | 'fat' | 'serving') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const toggleEnergy = (u: 'kcal' | 'kJ') => {
    if (u === energyUnit) return
    const n = Number(f.kcal)
    if (f.kcal !== '' && !isNaN(n)) {
      const converted = u === 'kJ' ? n * 4.184 : n / 4.184
      setF({ ...f, kcal: String(Math.round(converted * 10) / 10) })
    }
    setEnergyUnit(u)
  }
  const valid = Boolean(f.name.trim()) && f.kcal !== ''
  const per100 = isPer100(f.unit)
  const basis = per100 ? `per 100${f.unit}` : `per ${f.unit}`

  const submit = () => {
    if (!valid) return
    onSave({
      name: f.name.trim(),
      unit: f.unit,
      alcohol: f.alcohol,
      alcoholG: f.alcohol ? Number(f.alcoholG) || 0 : null,
      kcal: energyUnit === 'kJ' ? Math.round((Number(f.kcal) || 0) / 4.184) : Number(f.kcal) || 0,
      protein: Number(f.protein) || 0,
      carbs: Number(f.carbs) || 0,
      fat: Number(f.fat) || 0,
      serving: per100 ? Number(f.serving) || null : null,
    })
  }

  return (
    <Modal title={initial.name ? 'Edit food' : 'New food'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-3">
        <Field label="Name" value={f.name} onChange={set('name')} placeholder="Chicken breast" autoFocus />
        <div>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-mist">Unit</span>
          <div className="flex gap-1 rounded-full border border-edge bg-ink p-1">
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setF({ ...f, unit: u })}
                className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${
                  f.unit === u ? 'bg-raise text-bone' : 'text-mist'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-mist">Values {basis}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-mist">
              Energy {basis}
              <span className="flex gap-1 normal-case">
                {(['kcal', 'kJ'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => toggleEnergy(u)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                      energyUnit === u ? 'bg-raise text-bone' : 'text-mist'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </span>
            </span>
            <input
              type="number" inputMode="decimal" value={f.kcal} onChange={set('kcal')}
              className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-bone outline-none transition focus:border-grind/60"
            />
          </label>
          <Field label={`Protein (g) ${basis}`} type="number" inputMode="decimal" value={f.protein} onChange={set('protein')} />
          <Field label={`Carbs (g) ${basis}`} type="number" inputMode="decimal" value={f.carbs} onChange={set('carbs')} />
          <Field label={`Fat (g) ${basis}`} type="number" inputMode="decimal" value={f.fat} onChange={set('fat')} />
        </div>
        {per100 && (
          <Field label={`Default serving (${f.unit}, optional)`} type="number" inputMode="decimal" value={f.serving} onChange={set('serving')} placeholder="e.g. 150" />
        )}
        <label className="flex items-center gap-2 text-sm text-mist">
          <input
            type="checkbox" checked={f.alcohol}
            onChange={(e) => setF({ ...f, alcohol: e.target.checked })}
            className="size-4 accent-(--color-over)"
          />
          🍺 Alcohol <span className="text-xs text-over">(logs in red, no hiding)</span>
        </label>
        {f.alcohol && (
          <Field
            label={`Alcohol (g) ${basis}`} type="number" inputMode="decimal" step="0.1"
            value={f.alcoholG} onChange={set('alcoholG')} placeholder="e.g. 14"
          />
        )}
        <button
          type="submit"
          disabled={!valid}
          className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          Save
        </button>
      </form>
    </Modal>
  )
}
