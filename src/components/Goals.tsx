import { useState } from 'react'
import GoalWizard from './GoalWizard'
import { ACTIVITIES, DIETS, GOAL_RATES, planCheck } from '../lib/coach'
import { useGarmin } from '../hooks/useGarmin'
import { useHealth } from '../hooks/useHealth'
import { useMcp } from '../hooks/useMcp'
import { CopyButton, Field, Panel, Pencil } from './ui'
import type { Macros, Profile, Settings } from '../types'

type MacroKey = keyof Macros
// while editing, goal fields hold raw input strings
type GoalDraft = Record<MacroKey, string | number>

const FIELDS: [MacroKey, string][] = [
  ['kcal', 'Calories'],
  ['protein', 'Protein (g)'],
  ['carbs', 'Carbs (g)'],
  ['fat', 'Fat (g)'],
]

export default function Goals({ uid, settings, save }: {
  uid: string
  settings: Settings
  save: (s: Settings) => void
}) {
  const [wizard, setWizard] = useState(false)
  const onPlan = Boolean(settings.profile) && !settings.manualGoals

  return (
    <div className="max-w-lg space-y-4 lg:grid lg:max-w-none lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-4">
        {!onPlan && (
          <button
            type="button"
            onClick={() => setWizard(true)}
            className="w-full rounded-2xl border border-grind/40 bg-grind-soft/30 p-4 text-left transition hover:bg-grind-soft/50"
          >
            <div className="font-medium">🧠 Smart goal setup</div>
            <div className="mt-0.5 text-xs text-mist">
              {settings.profile
                ? "You're on manual goals. Run the wizard to switch back to a plan — past days keep their old goals."
                : 'Answer a few questions and get science-backed macros for your diet style.'}
            </div>
          </button>
        )}
        {onPlan ? (
          <PlanCard
            settings={settings}
            profile={settings.profile!}
            onRetune={() => setWizard(true)}
            onManual={() => save({ ...settings, manualGoals: true })}
          />
        ) : (
          <GoalsForm settings={settings} save={save} />
        )}
      </div>
      <div className="space-y-4">
        <GarminPanel uid={uid} />
        <PhoneHealthPanel uid={uid} />
        <McpPanel uid={uid} />
      </div>
      {wizard && (
        <GoalWizard
          initial={settings.profile}
          onSave={(next) => save({ ...next, manualGoals: false })}
          onClose={() => setWizard(false)}
        />
      )}
    </div>
  )
}

/* ---------- the wizard plan, shown instead of raw number boxes ---------- */

function PlanCard({ settings, profile, onRetune, onManual }: {
  settings: Settings
  profile: Profile
  onRetune: () => void
  onManual: () => void
}) {
  const c = planCheck(profile)
  const diet = DIETS.find((d) => d.id === profile.diet)
  const activity = ACTIVITIES.find((a) => a.id === profile.activity)
  const preset = GOAL_RATES.find((g) => g.rate === profile.goalRate)
  const age = new Date().getFullYear() - profile.birthYear
  const line = (g: Macros) => (
    <span className="tabular-nums"><b>{g.kcal}</b> kcal · P {g.protein} · C {g.carbs} · F {g.fat}</span>
  )

  const copyText = () =>
    [
      '# Meat Grinder — Goals (smart plan)',
      `Profile: ${profile.sex}, ${age}y, ${profile.heightCm}cm, ${profile.weightKg}kg · ${activity?.label ?? profile.activity} · ${profile.trainingDays ?? 0} training days/wk`,
      `Diet: ${diet?.label ?? profile.diet} · protein ${profile.proteinPerKg ?? diet?.proteinPerKg}g/kg`,
      `Pace: ${preset?.label ?? 'Custom target'} → honest ${c.actualRate} kg/week (${c.ratePctBw}% BW) · rest-day maintenance ~${c.tdee} kcal`,
      `Rest day: ${settings.rest.kcal} kcal | P ${settings.rest.protein}g | C ${settings.rest.carbs}g | F ${settings.rest.fat}g`,
      ...(settings.trainingEnabled
        ? [`Training day: ${settings.training.kcal} kcal | P ${settings.training.protein}g | C ${settings.training.carbs}g | F ${settings.training.fat}g`]
        : []),
    ].join('\n')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your plan</h2>
        <CopyButton text={copyText} />
      </div>

      <Panel className="overflow-hidden">
        <button
          type="button"
          onClick={onRetune}
          className="block w-full border-b border-edge bg-grind-soft/30 p-4 text-left transition hover:bg-grind-soft/50"
        >
          <div className="flex items-center justify-between">
            <div className="font-medium">🧠 {diet?.icon} {diet?.label} · {preset?.label ?? 'Custom target'}</div>
            <Pencil className="size-4 shrink-0 text-mist" />
          </div>
          <div className="mt-0.5 text-xs text-mist">
            {profile.sex === 'male' ? 'Male' : 'Female'}, {age} · {profile.heightCm} cm · {profile.weightKg} kg
            · {activity?.label.toLowerCase()} · {profile.trainingDays ?? 0} training days/wk — tap to retune
          </div>
        </button>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3 text-center text-sm">
            <div className="rounded-xl border border-edge bg-ink p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-mist">Maintenance (rest)</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{c.tdee}</div>
              <div className="text-[11px] text-mist">kcal/day</div>
            </div>
            <div className="rounded-xl border border-edge bg-ink p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-mist">Honest pace</div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${c.actualRate < 0 ? 'text-grind' : ''}`}>
                {c.actualRate > 0 ? '+' : ''}{c.actualRate}
              </div>
              <div className="text-[11px] text-mist">kg/week · {c.ratePctBw}% BW{c.capped ? ' · capped' : ''}</div>
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-grind">Rest day</span>
              {line(settings.rest)}
            </div>
            {settings.trainingEnabled && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wider text-grind">Training day</span>
                {line(settings.training)}
              </div>
            )}
          </div>

          <p className="text-[11px] leading-snug text-mist">
            Protein {profile.proteinPerKg ?? diet?.proteinPerKg} g/kg · estimates, not gospel — your weight trend
            in Reports is the real judge. Retune any time; past days keep the goals they were logged under.
          </p>
        </div>
      </Panel>

      <button
        type="button"
        onClick={onManual}
        className="w-full rounded-full border border-edge py-2.5 text-sm font-medium text-mist transition hover:text-bone"
      >
        Set goals manually instead
      </button>
    </div>
  )
}

// Samsung Health / Health Connect — only shown inside the Android app shell
function PhoneHealthPanel({ uid }: { uid: string }) {
  const h = useHealth(uid)
  if (!h.native) return null

  return (
    <Panel className="p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-medium">📱 Phone health sync</div>
        {h.enabled && <span className="text-xs font-medium text-grind">Enabled ✓</span>}
      </div>
      <p className="mb-4 text-xs text-mist">
        Reads your daily steps from Health Connect (Samsung Health, Google Fit, etc.) on this phone —
        no watch account needed. Steps sync automatically while you use the app.
      </p>
      {h.enabled ? (
        <div className="flex gap-2">
          <button
            type="button" disabled={h.busy}
            onClick={h.sync}
            className="flex-1 rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            {h.busy ? 'Syncing…' : 'Sync steps now'}
          </button>
          <button
            type="button" disabled={h.busy}
            onClick={h.disable}
            className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-mist hover:text-over"
          >
            Disable
          </button>
        </div>
      ) : (
        <button
          type="button" disabled={h.busy}
          onClick={h.connect}
          className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {h.busy ? 'Connecting…' : 'Connect Health Connect'}
        </button>
      )}
      {h.result && <p className="mt-3 text-xs text-mist">{h.result}</p>}
    </Panel>
  )
}

function McpPanel({ uid }: { uid: string }) {
  const { config, generate, revoke } = useMcp(uid)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'url' | 'key' | null>(null)

  const copy = async (what: 'url' | 'key', value: string) => {
    // trim hard — a stray newline in a pasted header breaks GPT Actions outright
    await navigator.clipboard.writeText(value.trim())
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }

  if (config === undefined) return null
  const url = config ? `${location.origin}/mcp/${config.key}` : null

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <Panel className="p-5">
      <div className="mb-1 font-medium">🤖 LLM connection (MCP)</div>
      <p className="mb-4 text-xs text-mist">
        Lets an AI assistant read your diary live — goals, meals, workouts, sleep, steps, heart rate —
        and add or edit foods in your library. The URL below is a secret: anyone who has it can access
        your data, so treat it like a password.
      </p>

      {url ? (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist">MCP URL (Claude, ChatGPT connectors)</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-ink px-3 py-2 text-xs text-bone">{url}</code>
              <button
                type="button"
                onClick={() => copy('url', url)}
                className="shrink-0 rounded-full bg-grind px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
              >
                {copied === 'url' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mist">Custom GPT schema URL (Actions — set Authentication: None)</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-edge bg-ink px-3 py-2 text-xs text-bone">{`${location.origin}/api/k/${config!.key}/openapi.json`}</code>
              <button
                type="button"
                onClick={() => copy('key', `${location.origin}/api/k/${config!.key}/openapi.json`)}
                className="shrink-0 rounded-full border border-grind/50 px-4 py-2 text-sm font-semibold text-grind transition hover:bg-grind-soft"
              >
                {copied === 'key' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="space-y-1 text-[11px] leading-snug text-mist">
            <p>Works with any MCP-capable AI assistant:</p>
            <p><b className="font-medium text-bone">Claude</b> — Settings → Connectors → Add custom connector → paste this URL.</p>
            <p><b className="font-medium text-bone">ChatGPT</b> — Settings → Apps &amp; Connectors → Advanced → enable Developer mode → Create connector → paste this URL (Plus/Pro).</p>
            <p><b className="font-medium text-bone">Custom GPT (Actions)</b> — edit your GPT → Add Action → Import from URL using the schema URL above → Authentication: <b className="font-medium text-bone">None</b> (your key is inside the URL).</p>
            <p><b className="font-medium text-bone">Claude Code / other tools</b> — add it as a remote MCP server URL.</p>
            <p>Then ask things like "how's my protein trending this month?"</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button" disabled={busy}
              onClick={() => act(generate)}
              className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-mist hover:text-bone disabled:opacity-40"
            >
              Regenerate (invalidates old URL)
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => act(revoke)}
              className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-mist hover:text-over disabled:opacity-40"
            >
              Revoke
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" disabled={busy}
          onClick={() => act(generate)}
          className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {busy ? 'Generating…' : 'Generate connection URL'}
        </button>
      )}
    </Panel>
  )
}

function GoalsForm({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const [form, setForm] = useState<{ trainingEnabled: boolean; rest: GoalDraft; training: GoalDraft }>({
    trainingEnabled: settings.trainingEnabled,
    rest: { ...settings.rest },
    training: { ...settings.training },
  })
  const [saved, setSaved] = useState(false)

  const setGoal = (which: 'rest' | 'training', key: MacroKey) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [which]: { ...form[which], [key]: e.target.value } })

  const submit = () => {
    const clean = (g: GoalDraft): Macros =>
      Object.fromEntries(FIELDS.map(([k]) => [k, Number(g[k]) || 0])) as unknown as Macros
    // keep the profile — energy zones and endurance fueling still need it
    save({
      trainingEnabled: form.trainingEnabled,
      rest: clean(form.rest),
      training: clean(form.training),
      ...(settings.profile ? { profile: settings.profile, manualGoals: true } : {}),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const copyText = () => {
    const line = (g: GoalDraft) => `${g.kcal} kcal | P ${g.protein}g | C ${g.carbs}g | F ${g.fat}g`
    return form.trainingEnabled
      ? `# Meat Grinder — Goals\nRest day: ${line(form.rest)}\nTraining day: ${line(form.training)}`
      : `# Meat Grinder — Goals\nDaily: ${line(form.rest)}`
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Daily goals</h2>
        <CopyButton text={copyText} />
      </div>

      <Panel className="p-5">
        <GoalGrid
          title={form.trainingEnabled ? 'Rest day' : 'Every day'}
          goal={form.rest}
          onChange={(k) => setGoal('rest', k)}
        />
      </Panel>

      <Panel className="p-5">
        <label className="flex cursor-pointer items-center justify-between">
          <div>
            <div className="font-medium">Separate training-day goals</div>
            <div className="text-xs text-mist">Toggle "Training day" on any day to switch goals</div>
          </div>
          <input
            type="checkbox"
            checked={form.trainingEnabled}
            onChange={(e) => setForm({ ...form, trainingEnabled: e.target.checked })}
            className="size-5 accent-(--color-grind)"
          />
        </label>
        {form.trainingEnabled && (
          <div className="mt-5">
            <GoalGrid title="Training day" goal={form.training} onChange={(k) => setGoal('training', k)} />
          </div>
        )}
      </Panel>

      <button
        type="submit"
        className="w-full rounded-full bg-grind py-3 font-semibold text-ink transition hover:brightness-110"
      >
        {saved ? 'Saved ✓' : 'Save goals'}
      </button>
    </form>
  )
}

function GarminPanel({ uid }: { uid: string }) {
  const { status, connect, connectTokens, syncNow, disconnect } = useGarmin(uid)
  const [method, setMethod] = useState<'password' | 'token'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tokenJson, setTokenJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = (await fn()) as { data?: { summary?: string } } | undefined
      setMsg({ ok: true, text: okMsg ?? res?.data?.summary ?? 'Done' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setMsg({ ok: false, text: message.replace(/^.*?:\s*/, '') || 'Failed' })
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  const tokenForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (busy || !tokenJson.trim()) return
        let parsed: unknown
        try {
          parsed = JSON.parse(tokenJson)
        } catch {
          setMsg({ ok: false, text: "That doesn't look like token JSON — paste the exact line the script printed." })
          return
        }
        run(() => connectTokens(parsed))
      }}
      className="space-y-2"
    >
      <div className="space-y-1 text-[11px] leading-snug text-mist">
        <p>Garmin sometimes blocks logins from servers, but never from your own computer. On any PC with <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-grind underline underline-offset-2">Node.js</a> installed:</p>
        <p>1. <a href="/garmin-token.mjs" download className="text-grind underline underline-offset-2">Download the token script</a> into a new folder.</p>
        <p>2. In a terminal in that folder: <code className="text-bone">npm i garmin-connect</code> then <code className="text-bone">node garmin-token.mjs</code></p>
        <p>3. It asks for your Garmin login (stays on your PC) and prints a line of JSON — paste it here:</p>
      </div>
      <textarea
        value={tokenJson}
        onChange={(e) => setTokenJson(e.target.value)}
        rows={3}
        placeholder='{"oauth1":…,"oauth2":…}'
        className="w-full rounded-lg border border-edge bg-ink px-3 py-2 font-mono text-xs text-bone outline-none focus:border-grind/60"
      />
      <button
        type="submit" disabled={busy || !tokenJson.trim()}
        className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? 'Connecting…' : 'Connect with token'}
      </button>
    </form>
  )

  return (
    <Panel className="p-5">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-medium">⌚ Garmin sync</div>
        {status.connected && <span className="text-xs font-medium text-grind">Connected ✓</span>}
      </div>
      <p className="mb-4 text-xs text-mist">
        Pulls sleep and workouts automatically every 3 hours. Burned calories are never added to your budget.
      </p>

      {status.pending && !status.connected ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-carbs/40 bg-carbs/10 p-3 text-xs text-carbs">
            Connection saved. Garmin is rate-limiting our server right now — we retry automatically
            every few hours and your password is deleted the moment login succeeds. Nothing more to do.
          </div>
          {status.lastError && <p className="text-xs text-mist">{status.lastError}</p>}
          <button
            type="button" disabled={busy}
            onClick={() => run(disconnect, 'Cancelled')}
            className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-mist hover:text-over"
          >
            Cancel
          </button>
          <div className="border-t border-edge pt-3">
            <p className="mb-2 text-xs font-medium text-bone">Don't want to wait? Connect with a token instead:</p>
            {tokenForm}
          </div>
        </div>
      ) : status.connected ? (
        <div className="space-y-3">
          <div className="text-xs text-mist">
            {status.lastSync ? `Last sync: ${new Date(status.lastSync).toLocaleString()} — ${status.lastResult ?? ''}` : 'First sync pending…'}
            {status.lastError && <span className="block text-over">Last error: {status.lastError}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button" disabled={busy}
              onClick={() => run(async () => {
                const r = await syncNow()
                setMsg({ ok: true, text: `Synced: ${r.data.summary}` })
                return r
              })}
              className="flex-1 rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button" disabled={busy}
              title="Backfill sleep, steps, heart rate and workouts for the last 30 days"
              onClick={() => run(async () => {
                const r = await syncNow(true)
                setMsg({ ok: true, text: `Resynced 30 days: ${r.data.summary}` })
                return r
              })}
              className="rounded-full border border-grind/50 px-4 py-2.5 text-sm font-semibold text-grind transition hover:bg-grind-soft disabled:opacity-40"
            >
              {busy ? '…' : 'Resync 30 days'}
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => run(disconnect, 'Disconnected')}
              className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-mist hover:text-over"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* either/or: password login OR pasted token */}
          <div className="flex gap-1 rounded-full border border-edge bg-ink p-1">
            {([['password', 'Email & password'], ['token', 'I have a token']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMethod(m); setMsg(null) }}
                className={`flex-1 rounded-full py-1.5 text-sm font-medium transition ${
                  method === m ? 'bg-raise text-bone' : 'text-mist'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {method === 'password' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (busy || !email || !password) return
                run(async () => {
                  const r = await connect(email, password)
                  setPassword('')
                  return r
                })
              }}
              className="space-y-3"
            >
              <Field label="Garmin email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Field label="Garmin password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-[11px] leading-snug text-mist">
                Used to sign in to Garmin once. If Garmin is rate-limiting, your login is kept in your private
                account data and retried automatically — it's deleted the moment the connection succeeds; only
                session tokens are kept after that.
              </p>
              <button
                type="submit" disabled={busy || !email || !password}
                className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
              >
                {busy ? 'Connecting…' : 'Connect Garmin'}
              </button>
            </form>
          ) : (
            tokenForm
          )}
        </div>
      )}

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? 'text-grind' : 'text-over'}`}>{msg.text}</p>
      )}
    </Panel>
  )
}

function GoalGrid({ title, goal, onChange }: {
  title: string
  goal: GoalDraft
  onChange: (k: MacroKey) => (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div>
      <div className="mb-3 text-xs font-medium uppercase tracking-wider text-grind">{title}</div>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(([key, label]) => (
          <Field
            key={key} label={label} type="number" inputMode="decimal"
            value={goal[key]} onChange={onChange(key)}
          />
        ))}
      </div>
    </div>
  )
}
