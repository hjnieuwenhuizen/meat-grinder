import { useState } from 'react'
import { useGarmin } from '../hooks/useGarmin'
import { CopyButton, Field, Panel } from './ui'

const FIELDS = [
  ['kcal', 'Calories'],
  ['protein', 'Protein (g)'],
  ['carbs', 'Carbs (g)'],
  ['fat', 'Fat (g)'],
]

export default function Goals({ uid, settings, save }) {
  const [form, setForm] = useState({
    trainingEnabled: settings.trainingEnabled,
    rest: { ...settings.rest },
    training: { ...settings.training },
  })
  const [saved, setSaved] = useState(false)

  const setGoal = (which, key) => (e) =>
    setForm({ ...form, [which]: { ...form[which], [key]: e.target.value } })

  const submit = () => {
    const clean = (g) => Object.fromEntries(FIELDS.map(([k]) => [k, Number(g[k]) || 0]))
    save({
      trainingEnabled: form.trainingEnabled,
      rest: clean(form.rest),
      training: clean(form.training),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const copyText = () => {
    const line = (g) => `${g.kcal} kcal | P ${g.protein}g | C ${g.carbs}g | F ${g.fat}g`
    return form.trainingEnabled
      ? `# Meat Grinder — Goals\nRest day: ${line(form.rest)}\nTraining day: ${line(form.training)}`
      : `# Meat Grinder — Goals\nDaily: ${line(form.rest)}`
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="max-w-lg space-y-4">
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

      <GarminPanel uid={uid} />
    </form>
  )
}

function GarminPanel({ uid }) {
  const { status, connect, connectTokens, syncNow, disconnect } = useGarmin(uid)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tokenJson, setTokenJson] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const run = async (fn, okMsg) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fn()
      setMsg({ ok: true, text: okMsg ?? res?.data?.summary ?? 'Done' })
    } catch (e) {
      setMsg({ ok: false, text: e.message?.replace(/^.*?:\s*/, '') || 'Failed' })
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

      {status.connected ? (
        <div className="space-y-3">
          <div className="text-xs text-mist">
            {status.lastSync ? `Last sync: ${new Date(status.lastSync).toLocaleString()} — ${status.lastResult ?? ''}` : 'First sync pending…'}
            {status.lastError && <span className="block text-over">Last error: {status.lastError}</span>}
          </div>
          <div className="flex gap-2">
            <button
              type="button" disabled={busy}
              onClick={() => run(() => syncNow().then((r) => { setMsg({ ok: true, text: `Synced: ${r.data.summary}` }); return r }), undefined)}
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
          <Field label="Garmin email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label="Garmin password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-[11px] leading-snug text-mist">
            Used once to sign in to Garmin — your password is never stored, only the resulting session tokens.
          </p>
          <button
            type="button" disabled={busy || !email || !password}
            onClick={() => run(() => connect(email, password).then((r) => { setPassword(''); return r }))}
            className="w-full rounded-full bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? 'Connecting…' : 'Connect Garmin'}
          </button>

          <button type="button" onClick={() => setAdvanced(!advanced)} className="text-xs text-mist underline-offset-2 hover:text-bone hover:underline">
            Advanced: connect with tokens
          </button>
          {advanced && (
            <div className="space-y-2">
              <p className="text-[11px] text-mist">
                If Garmin rate-limits the server, run <code className="text-bone">node functions/bootstrap.js</code> locally and paste the JSON here.
              </p>
              <textarea
                value={tokenJson}
                onChange={(e) => setTokenJson(e.target.value)}
                rows={3}
                placeholder='{"oauth1":…,"oauth2":…}'
                className="w-full rounded-lg border border-edge bg-ink px-3 py-2 font-mono text-xs text-bone outline-none focus:border-grind/60"
              />
              <button
                type="button" disabled={busy || !tokenJson.trim()}
                onClick={() => run(() => connectTokens(JSON.parse(tokenJson)))}
                className="w-full rounded-full border border-grind/50 py-2 text-sm font-semibold text-grind transition hover:bg-grind-soft disabled:opacity-40"
              >
                Connect with tokens
              </button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? 'text-grind' : 'text-over'}`}>{msg.text}</p>
      )}
    </Panel>
  )
}

function GoalGrid({ title, goal, onChange }) {
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
