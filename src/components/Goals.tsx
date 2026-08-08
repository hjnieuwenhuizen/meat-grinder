import { useState } from 'react'
import { useGarmin } from '../hooks/useGarmin'
import { CopyButton, Field, Panel } from './ui'
import type { Macros, Settings } from '../types'

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
  return (
    <div className="max-w-lg space-y-4">
      <GoalsForm settings={settings} save={save} />
      <GarminPanel uid={uid} />
    </div>
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
    save({
      trainingEnabled: form.trainingEnabled,
      rest: clean(form.rest),
      training: clean(form.training),
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
        </div>
      ) : status.connected ? (
        <div className="space-y-3">
          <div className="text-xs text-mist">
            {status.lastSync ? `Last sync: ${new Date(status.lastSync).toLocaleString()} — ${status.lastResult ?? ''}` : 'First sync pending…'}
            {status.lastError && <span className="block text-over">Last error: {status.lastError}</span>}
          </div>
          <div className="flex gap-2">
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
