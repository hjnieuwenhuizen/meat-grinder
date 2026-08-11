// Smart goal setup: a short interview → science-backed macros.
// BMR (Mifflin-St Jeor) × lifestyle → target rate → diet-style macro split.
import { useState } from 'react'
import { ACTIVITIES, DIETS, GOAL_RATES, PROTEIN_CHOICES, recommendedProtein, buildPlan, planCheck, restTdee, bmr, refWeightKg, KCAL_PER_KG } from '../lib/coach'
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
  const [proteinPerKg, setProteinPerKg] = useState(initial?.proteinPerKg ?? 2.0)
  const [goalRate, setGoalRate] = useState(initial?.goalRate ?? -0.5)
  const [customKcal, setCustomKcal] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  // Custom target: user types exact rest-day kcal; we derive the equivalent
  // rate so all downstream math stays consistent
  const baseProfile: Profile | null =
    birthYear && heightCm && weightKg
      ? {
          sex,
          birthYear: Number(birthYear),
          heightCm: Number(heightCm),
          weightKg: Number(weightKg),
          activity,
          diet,
          proteinPerKg,
          goalRate,
          trainingDays,
        }
      : null
  const customRate =
    baseProfile && useCustom && Number(customKcal) >= 1000
      ? Math.round(((Number(customKcal) - restTdee(baseProfile)) * 7 / KCAL_PER_KG) * 100) / 100
      : null
  const profile: Profile | null = baseProfile
    ? { ...baseProfile, goalRate: customRate ?? goalRate, ...(customRate !== null ? { customTarget: true } : {}) }
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
    <Modal title="Smart goal setup" onClose={onClose} size="lg">
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
          {(() => {
            // pounds typed into the kg box is the classic silent killer here
            const w = Number(weightKg)
            const h = Number(heightCm)
            if (!w || !h || h < 100) return null
            const bmi = w / (h / 100) ** 2
            if (bmi < 15 || bmi > 42)
              return (
                <p className="rounded-lg border border-carbs/40 bg-carbs/10 p-2 text-[11px] text-carbs">
                  Just checking: {w} kg at {h} cm (BMI ≈ {Math.round(bmi)}). If that's right, carry on —
                  protein and fat scale from adjusted bodyweight so targets stay realistic. If you meant
                  pounds: {w} lb = {Math.round(w / 2.2046)} kg.
                </p>
              )
            return null
          })()}
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
                <div className="text-xs text-mist">{d.blurb}</div>
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-mist">Protein target — separate from diet style</div>
            <div className="flex gap-1.5">
              {PROTEIN_CHOICES.map((g) => (
                <button
                  key={g} type="button" onClick={() => setProteinPerKg(g)}
                  className={`flex-1 rounded-xl border p-2 text-center transition ${
                    proteinPerKg === g ? 'border-grind/60 bg-grind-soft' : 'border-edge bg-ink hover:border-grind/30'
                  }`}
                >
                  <div className="text-sm font-medium tabular-nums">{g} g/kg</div>
                  <div className="text-[10px] text-mist">
                    {weightKg && heightCm ? `${Math.round(g * refWeightKg({ weightKg: Number(weightKg), heightCm: Number(heightCm) }))}g` : ''}
                    {g === recommendedProtein(goalRate) ? ' · recommended' : ''}
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-mist">
              Cutting? Higher protein (2.0–2.2) protects muscle. A high-carb cutter can want 2.2 too.
              {weightKg && heightCm && refWeightKg({ weightKg: Number(weightKg), heightCm: Number(heightCm) }) < Number(weightKg) && (
                <> Gram targets use <b className="text-bone">adjusted bodyweight</b> ({refWeightKg({ weightKg: Number(weightKg), heightCm: Number(heightCm) })} kg) — per-kg-of-actual-weight over-prescribes at higher BMI.</>
              )}
            </p>
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
            {GOAL_RATES.map((g) => {
              const pctBw = weightKg ? Math.round((Math.abs(g.rate) / Number(weightKg)) * 1000) / 10 : null
              const fast = g.rate < 0 && pctBw !== null && pctBw > 0.85
              return (
                <button key={g.rate} type="button" onClick={() => setGoalRate(g.rate)} className={`flex w-full items-center justify-between ${chip(goalRate === g.rate)}`}>
                  <span>
                    <span className="block text-sm font-medium">{g.label}{fast ? ' ⚠️' : ''}</span>
                    <span className="block text-xs text-mist">{g.blurb}{pctBw ? ` · ${pctBw}% BW/week` : ''}</span>
                  </span>
                  <span className="text-xs tabular-nums text-mist">{g.rate > 0 ? '+' : ''}{Math.round((g.rate * KCAL_PER_KG) / 7)} kcal/d</span>
                </button>
              )
            })}
          </div>
          <div className={`rounded-xl border p-3 ${useCustom ? 'border-grind/60 bg-grind-soft' : 'border-edge bg-ink'}`}>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="block font-medium">Custom target</span>
                <span className="block text-xs text-mist">Coach gave you a number? Type exact rest-day calories.</span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="number" inputMode="numeric" placeholder="1900"
                  value={customKcal}
                  onFocus={() => setUseCustom(true)}
                  onChange={(e) => { setCustomKcal(e.target.value); setUseCustom(true) }}
                  className="w-24 rounded-lg border border-edge bg-panel px-2 py-1.5 text-center text-bone outline-none focus:border-grind/60"
                />
                <span className="text-xs text-mist">kcal</span>
              </span>
            </label>
            {customRate !== null && (
              <p className="mt-1 text-[11px] text-mist">≈ {customRate > 0 ? '+' : ''}{customRate} kg/week vs your rest-day maintenance</p>
            )}
            {useCustom && (
              <button type="button" onClick={() => { setUseCustom(false); setCustomKcal('') }} className="mt-1 text-[11px] text-mist underline-offset-2 hover:text-bone hover:underline">
                back to preset paces
              </button>
            )}
          </div>

          {profile && youValid && (() => {
            const c = planCheck(profile)
            if (!c.tooFast && !c.capped && !c.belowBmr) return null
            return (
              <p className="rounded-lg border border-over/40 bg-over/10 p-2 text-[11px] text-over">
                {c.tooFast && <>That's {c.ratePctBw}% of bodyweight/week — beyond the muscle-safe band of 0.4–0.7%. Fine for a short block; not a lifestyle. </>}
                {c.capped && <>Preset paces prescribe at most a {c.capPct}% deficit, so the plan lands at {c.targetKcal} kcal — the honest pace is <b>{c.actualRate} kg/week</b>, not the pace you picked.{!profile.customTarget && <> Want deeper? Type a custom target (hard max 25%).</>} </>}
                {c.belowBmr && !c.capped && <>Heads-up: this sits below your estimated BMR ({Math.round(bmr(profile))} kcal). Not a hard stop — BMR is an estimate, not a safety threshold — but let your weight trend and recovery be the judge.</>}
              </p>
            )
          })()}

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
                {profile && (() => {
                  const c = planCheck(profile)
                  return <>honest pace ≈ <b className="text-bone">{c.actualRate > 0 ? '+' : ''}{c.actualRate} kg/week</b> ({c.deficitPctTdee > 0 ? `${c.deficitPctTdee}% deficit · ` : ''}{c.ratePctBw}% BW{c.capped ? `, after the ${c.capPct}% cap` : ''})</>
                })()} · retune any time — past days keep the goals they were logged under
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
