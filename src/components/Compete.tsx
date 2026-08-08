import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { fetchChallengeScores, type FamilyApi } from '../hooks/useFamily'
import { SCORE_ITEMS, MAX_POINTS, METRICS } from '../lib/score'
import { todayKey, fmtDay, fmtShort, fromKey, addDays, startOfWeek, weekKeys } from '../lib/dates'
import { Panel, Field, Modal, Check, Clipboard, Plus, Trash } from './ui'
import type { ChallengeDoc, ChallengeMetric, FamilyMember, ScoreDoc } from '../types'

interface FamilyProps {
  user: User
  fam: FamilyApi
}

const AVATAR_PX = 96

/** center-crop + resize to a tiny data-URL so it fits in the Firestore doc */
const resizeAvatar = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = AVATAR_PX
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas')); return }
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')) }
    img.src = url
  })

const memberOf = (user: User): FamilyMember => ({
  name: user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'Anonymous',
  photo: user.photoURL ?? null,
  joinedAt: Date.now(),
})

export default function Compete({ user, fam }: FamilyProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [board, setBoard] = useState<'family' | 'global'>('family')

  if (fam.code === undefined) {
    return <div className="py-20 text-center text-mist">Loading…</div>
  }

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return
    try { await fam.setPhoto(await resizeAvatar(file)) } catch { /* bad image — ignore */ }
  }

  return (
    <div className="space-y-4">
      {/* board switcher */}
      <div className="flex justify-center">
        <div className="flex gap-1 rounded-full border border-edge bg-panel p-1">
          {([['family', '🏆 Family'], ['global', '🌍 Global']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setBoard(id)}
              className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${
                board === id ? 'bg-grind text-ink' : 'text-mist hover:text-bone'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {board === 'family'
        ? (fam.code && fam.family
            ? <FamilyBoard user={user} fam={fam} onAvatar={() => fileRef.current?.click()} />
            : <Setup user={user} fam={fam} />)
        : <GlobalBoard user={user} fam={fam} onAvatar={() => fileRef.current?.click()} />}

      <ScoringLegend />

      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { void onPickPhoto(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

/* --- create / join a family --- */

function Setup({ user, fam }: FamilyProps) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') }
    setBusy(false)
  }

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    void run(() => fam.create(name, memberOf(user)))
  }
  const onJoin = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) void run(() => fam.join(code, memberOf(user)))
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="pt-6 text-center">
        <div className="text-4xl">🏆</div>
        <h2 className="mt-2 text-lg font-semibold">Family leaderboard</h2>
        <p className="mt-1 text-sm text-mist">
          Compete on steps, protein, workouts, sleep and more. Only daily scores are shared — never your food diary.
        </p>
      </div>

      <Panel className="p-5">
        <form onSubmit={onCreate} className="space-y-3">
          <Field label="Start a family" placeholder="e.g. The Nieuwenhuizens" value={name} onChange={(e) => setName(e.target.value)} />
          <button disabled={busy} className="w-full rounded-lg bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-50">
            Create & get invite code
          </button>
        </form>
      </Panel>

      <Panel className="p-5">
        <form onSubmit={onJoin} className="space-y-3">
          <Field label="Or join with a code" placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" />
          <button disabled={busy || !code.trim()} className="w-full rounded-lg border border-grind/60 bg-grind-soft py-2.5 text-sm font-semibold text-grind transition hover:brightness-110 disabled:opacity-50">
            Join family
          </button>
        </form>
      </Panel>

      {error && <p className="text-center text-sm text-over">{error}</p>}
    </div>
  )
}

/* --- standings (shared by family + global) --- */

interface Row {
  uid: string
  member: FamilyMember
  week: number
  steps: number
  today: ScoreDoc | null
}

const buildRows = (members: Record<string, FamilyMember>, scores: ScoreDoc[], today: string): Row[] => {
  const byUid: Record<string, ScoreDoc[]> = {}
  for (const s of scores) (byUid[s.uid] ??= []).push(s)
  return Object.entries(members)
    .map(([uid, m]) => {
      const days = byUid[uid] ?? []
      return {
        uid, member: m,
        week: days.reduce((a, d) => a + d.points, 0),
        steps: days.reduce((a, d) => a + d.steps, 0),
        today: days.find((d) => d.date === today) ?? null,
      }
    })
    .sort((a, b) => b.week - a.week || b.steps - a.steps || a.member.name.localeCompare(b.member.name))
}

const medal = (rank: number) => (rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : null)

function Standings({ rows, uid, onAvatar }: { rows: Row[]; uid: string; onAvatar: () => void }) {
  const maxSteps = Math.max(1, ...rows.map((r) => r.steps))
  return (
    <Panel className="divide-y divide-edge">
      {rows.map((r, i) => {
        const mine = r.uid === uid
        return (
          <div key={r.uid} className="flex items-center gap-3 p-4">
            <div className="w-7 text-center text-lg">{medal(i) ?? <span className="text-sm text-mist">{i + 1}</span>}</div>
            <Avatar member={r.member} mine={mine} onClick={mine ? onAvatar : undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate font-semibold">{r.member.name}{mine && <span className="ml-1.5 text-xs font-normal text-mist">you</span>}</span>
                {i === 0 && r.week > 0 && <span title="Weekly leader">👑</span>}
              </div>
              {/* steps race bar */}
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raise">
                <div className="h-full rounded-full bg-grind transition-all duration-500" style={{ width: `${(r.steps / maxSteps) * 100}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-mist">
                <span>👟 {r.steps.toLocaleString()} steps this week</span>
                <TodayChips score={r.today} />
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums text-grind">{r.week}</div>
              <div className="text-[10px] uppercase tracking-wider text-mist">pts</div>
            </div>
          </div>
        )
      })}
    </Panel>
  )
}

/* --- family board --- */

function FamilyBoard({ user, fam, onAvatar }: FamilyProps & { onAvatar: () => void }) {
  const family = fam.family!
  const code = fam.code!
  const [copied, setCopied] = useState(false)
  const today = todayKey()
  const rows = useMemo(() => buildRows(family.members, fam.scores, today), [family.members, fam.scores, today])
  const week = weekKeys(startOfWeek(today))

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">🏆 {family.name}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copyCode}
            className="flex items-center gap-1.5 rounded-full border border-edge bg-raise px-3 py-1.5 text-xs font-medium text-mist transition hover:border-grind/50 hover:text-bone"
            title="Copy invite code">
            {copied ? <><Check className="size-3.5 text-grind" /> Copied</> : <><Clipboard className="size-3.5" /> Invite: {code}</>}
          </button>
          <button type="button" onClick={() => { if (confirm('Leave this family?')) void fam.leave() }}
            className="text-xs text-mist hover:text-over">
            Leave
          </button>
        </div>
      </div>
      <p className="text-xs text-mist">
        Week of {fmtDay(week[0])} – {fmtDay(week[6])} · crown resets Monday · tap your avatar to change it
      </p>
      <Standings rows={rows} uid={user.uid} onAvatar={onAvatar} />
      <Challenges user={user} fam={fam} />
    </div>
  )
}

/* --- challenges: long-range comps, e.g. "most steps Sep–Dec" --- */

function Challenges({ user, fam }: FamilyProps) {
  const [creating, setCreating] = useState(false)
  const today = todayKey()
  const active = fam.challenges.filter((c) => c.end >= today).sort((a, b) => a.end.localeCompare(b.end))
  const past = fam.challenges.filter((c) => c.end < today).sort((a, b) => b.end.localeCompare(a.end))

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-mist">Challenges</h3>
        <button type="button" onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-full border border-grind/60 bg-grind-soft px-3 py-1.5 text-xs font-semibold text-grind transition hover:brightness-110">
          <Plus className="size-3.5" /> New challenge
        </button>
      </div>

      {!active.length && !past.length && (
        <Panel className="p-4 text-sm text-mist">
          No challenges yet. Start one — e.g. "Most steps to New Year" — and the whole family is automatically in.
        </Panel>
      )}
      {active.map((c) => <ChallengeCard key={c.id} c={c} user={user} fam={fam} />)}

      {past.length > 0 && (
        <>
          <h3 className="pt-2 text-xs font-medium uppercase tracking-wider text-mist">Finished</h3>
          {past.map((c) => <ChallengeCard key={c.id} c={c} user={user} fam={fam} />)}
        </>
      )}

      {creating && (
        <NewChallenge
          onSave={(c) => { void fam.addChallenge(c); setCreating(false) }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}

function ChallengeCard({ c, user, fam }: FamilyProps & { c: ChallengeDoc }) {
  const [scores, setScores] = useState<ScoreDoc[] | null>(null)
  const metric = METRICS[c.metric]
  const today = todayKey()
  const done = c.end < today

  // fam.scores in the deps refreshes totals when this week's scores change
  useEffect(() => {
    let on = true
    void fetchChallengeScores(fam.code!, c.start, c.end).then((s) => { if (on) setScores(s) })
    return () => { on = false }
  }, [fam.code, c.start, c.end, fam.scores])

  const rows = useMemo(() => {
    if (!scores) return []
    return Object.entries(fam.family!.members)
      .map(([uid, m]) => ({
        uid, member: m,
        total: scores.filter((s) => s.uid === uid).reduce((a, s) => a + metric.of(s), 0),
      }))
      .sort((a, b) => b.total - a.total || a.member.name.localeCompare(b.member.name))
  }, [scores, fam.family, metric])

  const lead = rows[0]?.total ?? 0
  const daysLeft = Math.max(0, Math.ceil((fromKey(c.end).getTime() - Date.now()) / 86400000))
  const totalDays = Math.max(1, (fromKey(c.end).getTime() - fromKey(c.start).getTime()) / 86400000)
  const elapsed = Math.min(1, Math.max(0, (Date.now() - fromKey(c.start).getTime()) / (totalDays * 86400000)))

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{metric.emoji} {c.name}</div>
          <div className="mt-0.5 text-xs text-mist">
            {metric.label} · {fmtShort(c.start)} – {fmtShort(c.end)} ·{' '}
            {done ? '🏁 finished' : c.start > today ? `starts ${fmtShort(c.start)}` : `${daysLeft} days left`}
          </div>
        </div>
        {c.createdBy === user.uid && (
          <button type="button" onClick={() => { if (confirm(`Delete "${c.name}"?`)) void fam.removeChallenge(c.id) }}
            className="p-1 text-mist transition hover:text-over" title="Delete challenge">
            <Trash className="size-4" />
          </button>
        )}
      </div>

      {!done && (
        <div className="h-1 overflow-hidden rounded-full bg-raise">
          <div className="h-full rounded-full bg-grind/50" style={{ width: `${elapsed * 100}%` }} />
        </div>
      )}

      {scores === null ? (
        <div className="text-sm text-mist">Loading…</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.uid} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-center">{medal(i) ?? <span className="text-xs text-mist">{i + 1}</span>}</span>
              <span className={`truncate font-medium ${r.uid === user.uid ? 'text-grind' : ''}`}>
                {r.member.name}{i === 0 && r.total > 0 && (done ? ' 🏆' : ' 👑')}
              </span>
              <span className="ml-auto tabular-nums font-semibold">{metric.fmt(r.total)}</span>
              {i > 0 && lead > r.total && (
                <span className="w-24 text-right text-xs tabular-nums text-mist">−{metric.fmt(lead - r.total)}</span>
              )}
              {i === 0 && <span className="w-24" />}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function NewChallenge({ onSave, onClose }: {
  onSave: (c: Omit<ChallengeDoc, 'id' | 'createdBy' | 'createdAt'>) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [metric, setMetric] = useState<ChallengeMetric>('steps')
  const [start, setStart] = useState(todayKey())
  const [end, setEnd] = useState(addDays(todayKey(), 55))
  const valid = Boolean(name.trim()) && end > start

  return (
    <Modal title="New challenge" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSave({ name: name.trim(), metric, start, end })
        }}
      >
        <Field label="Name" placeholder="Most steps to New Year" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-mist">Compete on</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as ChallengeMetric)}
            className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-bone outline-none transition focus:border-grind/60"
          >
            {(Object.keys(METRICS) as ChallengeMetric[]).map((m) => (
              <option key={m} value={m}>{METRICS[m].emoji} {METRICS[m].label}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Field label="Ends" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <p className="text-xs text-mist">Everyone in the family competes automatically.</p>
        <button disabled={!valid} className="w-full rounded-lg bg-grind py-2.5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-50">
          Start challenge
        </button>
      </form>
    </Modal>
  )
}

/* --- global board --- */

function GlobalBoard({ user, fam, onAvatar }: FamilyProps & { onAvatar: () => void }) {
  const today = todayKey()
  const rows = useMemo(
    () => buildRows(fam.globalMembers, fam.globalScores, today),
    [fam.globalMembers, fam.globalScores, today],
  )

  if (!fam.global) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="font-semibold">🌍 Global leaderboard</div>
          <p className="mt-0.5 text-sm text-mist">
            Compete against every Meat Grinder user. Your first name, photo and daily scores become visible to other players.
          </p>
        </div>
        <button type="button" onClick={() => void fam.joinGlobal(memberOf(user))}
          className="rounded-lg border border-grind/60 bg-grind-soft px-4 py-2 text-sm font-semibold text-grind transition hover:brightness-110">
          Join global
        </button>
      </Panel>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-mist">Every Meat Grinder player, this week · crown resets Monday</p>
        <button type="button" onClick={() => { if (confirm('Leave the global leaderboard?')) void fam.leaveGlobal() }}
          className="text-xs text-mist hover:text-over">
          Leave
        </button>
      </div>
      {rows.length
        ? <Standings rows={rows} uid={user.uid} onAvatar={onAvatar} />
        : <Panel className="p-5 text-sm text-mist">No players yet this week.</Panel>}
    </div>
  )
}

/* --- bits --- */

function ScoringLegend() {
  return (
    <Panel className="p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-mist">How to score (max {MAX_POINTS}/day)</div>
      <div className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {SCORE_ITEMS.map((it) => (
          <div key={it.key} className="flex items-center justify-between gap-2 rounded-lg bg-raise px-3 py-1.5">
            <span>{it.emoji} <span className="text-bone">{it.label}</span></span>
            <span className="font-semibold tabular-nums text-grind">+{it.max}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-mist">
        Targets are relative to each person's own goals, so everyone competes fairly. No Garmin? Enter steps by hand on the Diary tab.
      </p>
    </Panel>
  )
}

function Avatar({ member, mine, onClick }: { member: FamilyMember; mine: boolean; onClick?: () => void }) {
  const inner = member.photo
    ? <img src={member.photo} alt={member.name} referrerPolicy="no-referrer" className="size-full object-cover" />
    : <span className="text-lg font-bold text-grind">{member.name.charAt(0).toUpperCase()}</span>
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      title={mine ? 'Change photo' : member.name}
      className={`flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-grind-soft ${
        mine ? 'border-grind/60 hover:brightness-110' : 'border-edge'
      }`}>
      {inner}
    </button>
  )
}

function TodayChips({ score }: { score: ScoreDoc | null }) {
  if (!score) return <span>today: –</span>
  const earned = SCORE_ITEMS.filter((it) => score.breakdown?.[it.key] > 0)
  return (
    <span className="truncate" title={earned.map((e) => e.label).join(', ')}>
      today: {earned.length ? earned.map((e) => e.emoji).join(' ') : '–'} <b className="text-bone">{score.points}</b>
    </span>
  )
}
