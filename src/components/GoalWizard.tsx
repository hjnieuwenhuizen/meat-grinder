// Smart goal setup: a short interview → science-backed macros.
// BMR (Mifflin-St Jeor) × lifestyle → target rate → diet-style macro split.
import { useState } from 'react'
import { ACTIVITIES, DIETS, GOAL_RATES, buildPlan, restTdee, kgPerWeek, KCAL_PER_KG } from '../lib/coach'
import { Modal, Field } from './ui'
import type { ActivityId, DietId, Profile, Settings } from '../types'

const STEPS = ['You', 'Lifestyle', 'Diet', 'Goal'] as const

export default function GoalWizard({ initial, onSave, onClose }: {
  initial?: Profile
  onSave: (settings: Omit<Settings, 'profile'> & { profile: Profile }) => void
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [sex, setSex] = useState<'male' | 'female'>(initial?.sex ?? 'male')
  const [birthYear, setBirthYear] = useState(initial ? String(initial.birthYear) : '')
  const [heightCm, setHeightCm] = useState(initial ? String(initial.heightCm) : '')
  const [weightKg, setWeightKg] = useState(initial ? String(initial.weightKg) : '')
  const [activity, setActivity] = useState<ActivityId>(initial?.activity ?? 'light')
  const [trainingDays, setTrainingDays] = useState(initial?.trainingDays ?? 4)
  const [diet, setDiet] = useState<DietId>(initial?.diet ?? 'balanced')
  const [goalRate, setGoalRate] = useState(initial?.goalRate ?? -0.5)

  const profile: Profile | null =
    birthYear && heightCm && weightKg
      ? {
          sex,
          birthYear: Number(birthYear),
          heightCm: Number(heightCm),
          weightKg: Number(weightKg),
          activity,
          diet,
          goalRate,
          trainingDays,
        }
      : null

  const youValid =
    Number(birthYear) > 1920 && Number(birthYear) < 2015 &&
    Number(heightCm) >= 120 && Number(heightCm) <= 230 &&
    Number(weightKg) >= 35 && Number(weightKg) <= 250

  const plan = profile && youValid ? buildPlan(profile) : null
  const maintenance = profile && youValid ? Math.round(restTdee(profile)) : null

  const chip = (active: boolean) =>
    `rounded-xl border p-3 text-left transition ${
      active ? 'border-grind/60 bg-grind-soft' : 'border-edge bg-ink hover:border-grind/30'
    }`

  return (
    <Modal title="Smart goal setup" onClose={onClose}>
      {/* step dots */}
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => i < step && setStep(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              i === step ? 'bg-grind text-ink' : i < step ? 'bg-grind-soft text-grind' : 'bg-raise text-mist'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <div className="flex gap-1 rounded-full border border-edge bg-ink p-1">
            {(['male', 'female'] as const).map((s) => (
              <button
                key={s} type="button" onClick={() => setSex(s)}
                className={`flex-1 rounded-full py-1.5 text-sm font-medium capitalize transition ${sex === s ? 'bg-raise text-bone' : 'text-mist'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Birth year" type="number" inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="1990" autoFocus />
            <Field label="Height (cm)" type="number" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="180" />
            <Field label="Weight (kg)" type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="85" />
          </div>
          <p className="text-[11px] text-mist">Used only to calculate your calorie burn (Mifflin-St Jeor) — stays in your account.</p>
          <button
            type="button" disabled={!youValid}
            onClick={() => setStep(1)}
            className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-mist">Your day-to-day <b className="text-bone">outside the gym</b> — logged workouts are counted separately, so don't include them here.</p>
          <div className="space-y-1.5">
            {ACTIVITIES.map((a) => (
              <button key={a.id} type="button" onClick={() => setActivity(a.id)} className={`block w-full ${chip(activity === a.id)}`}>
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-xs text-mist">{a.blurb}</div>
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between rounded-xl border border-edge bg-ink p-3 text-sm">
            <span>Training days per week</span>
            <input
              type="number" min={0} max={7} value={trainingDays}
              onChange={(e) => setTrainingDays(Math.max(0, Math.min(7, Number(e.target.value) || 0)))}
              className="w-14 rounded-lg border border-edge bg-panel px-2 py-1 text-center text-bone outline-none"
            />
          </label>
          <button type="button" onClick={() => setStep(2)} className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110">
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-mist">How do you want to eat? This sets your protein level and how the remaining energy splits.</p>
          <div className="space-y-1.5">
            {DIETS.map((d) => (
              <button key={d.id} type="button" onClick={() => setDiet(d.id)} className={`block w-full ${chip(diet === d.id)}`}>
                <div className="text-sm font-medium">{d.icon} {d.label}</div>
                <div className="text-xs text-mist">{d.blurb} · {d.proteinPerKg}g protein/kg</div>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setStep(3)} className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110">
            Next
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {maintenance && (
            <p className="text-xs text-mist">
              Your rest-day maintenance is about <b className="text-bone">{maintenance} kcal</b>. Pick a pace:
            </p>
          )}
          <div className="space-y-1.5">
            {GOAL_RATES.map((g) => (
              <button key={g.rate} type="button" onClick={() => setGoalRate(g.rate)} className={`flex w-full items-center justify-between ${chip(goalRate === g.rate)}`}>
                <span>
                  <span className="block text-sm font-medium">{g.label}</span>
                  <span className="block text-xs text-mist">{g.blurb}</span>
                </span>
                <span className="text-xs tabular-nums text-mist">{g.rate > 0 ? '+' : ''}{Math.round((g.rate * KCAL_PER_KG) / 7)} kcal/d</span>
              </button>
            ))}
          </div>
          {goalRate <= -1 && (
            <p className="rounded-lg border border-over/40 bg-over/10 p-2 text-[11px] text-over">
              −1 kg/week is a big deficit. Protein and training matter double here — run it in short blocks, not months.
            </p>
          )}

          {plan && (
            <div className="rounded-xl border border-grind/40 bg-grind-soft/30 p-3 text-sm">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-grind">Your plan</div>
              <div className="tabular-nums">
                Rest day: <b>{plan.rest.kcal}</b> kcal · P {plan.rest.protein} · C {plan.rest.carbs} · F {plan.rest.fat}
              </div>
              {plan.trainingEnabled && (
                <div className="tabular-nums">
                  Training day: <b>{plan.training.kcal}</b> kcal · P {plan.training.protein} · C {plan.training.carbs} · F {plan.training.fat}
                </div>
              )}
              <div className="mt-1 text-xs text-mist">
                ≈ {kgPerWeek((goalRate * KCAL_PER_KG) / 7) > 0 ? '+' : ''}{goalRate} kg/week · you can retune any time — past days keep the goals they were logged under
              </div>
            </div>
          )}

          <button
            type="button" disabled={!plan || !profile}
            onClick={() => {
              if (!plan || !profile) return
              onSave({ trainingEnabled: plan.trainingEnabled, rest: plan.rest, training: plan.training, profile })
              onClose()
            }}
            className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            Save my plan
          </button>
        </div>
      )}
    </Modal>
  )
}
