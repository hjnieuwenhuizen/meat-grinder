import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ingestGarminActivity, pickGarminShell, mergedName, type MergeWorkout, type GarminAct } from '../src/merge.js'

let n = 0
const newId = () => `new-${++n}`
const T0 = Date.UTC(2026, 7, 22, 7, 0) // 22 Aug 2026 07:00

const sets = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `s${i}`, exercise: 'Lat pulldown', weightKg: 73, reps: 8, note: 'keep me' }))

const setsCard = (type: string, extra: Partial<MergeWorkout> = {}): MergeWorkout => ({
  id: 'manual', type, name: null, duration: null, kcal: null, sets: sets(23), startedAt: T0 + 50 * 60_000, ...extra,
})

const garminStrength = (extra: Partial<GarminAct> = {}): GarminAct => ({
  activityId: 555001, type: 'strength', name: 'Strength', startMs: T0, durationMin: 49, kcal: 555,
  distanceKm: null, meal: 'breakfast', metrics: { avgHr: 138, maxHr: 167 }, ...extra,
})

for (const type of ['pull', 'push', 'legs', 'strength']) {
  test(`${type} sets card + Garmin strength sync → one merged workout`, () => {
    const r = ingestGarminActivity([setsCard(type)], garminStrength(), newId)
    assert.equal(r.action, 'merged')
    assert.equal(r.workouts.length, 1)
    const w = r.workouts[0]
    assert.equal(w.type, type, 'specific split type preserved')
    assert.equal(w.garminId, 555001)
    assert.equal(w.duration, 49)
    assert.equal(w.kcal, 555)
    assert.equal(w.avgHr, 138)
    assert.equal(w.maxHr, 167)
    assert.equal(w.sets?.length, 23, 'all sets preserved')
    assert.equal((w.sets?.[0] as { note: string }).note, 'keep me', 'set metadata preserved')
    assert.equal(w.name, type === 'strength' ? 'Strength' : null, 'generic Garmin label never overwrites a split day')
  })
}

test('non-strength activity on the same day is left alone and added separately', () => {
  const r = ingestGarminActivity([setsCard('pull')], garminStrength({ activityId: 777, type: 'run', name: 'Recovery', durationMin: 5, kcal: 48, distanceKm: 0.3 }), newId)
  assert.equal(r.action, 'added')
  assert.equal(r.workouts.length, 2)
  assert.equal(r.workouts[0].garminId, undefined, 'sets card untouched')
  assert.equal(r.workouts[1].type, 'run')
})

test('two genuine strength sessions are not collapsed: time-matched to the right card', () => {
  const morning = setsCard('push', { id: 'am', startedAt: T0 + 10 * 60_000 })
  const evening = setsCard('pull', { id: 'pm', startedAt: T0 + 11 * 3600_000 })
  const r = ingestGarminActivity([morning, evening], garminStrength({ activityId: 1, startMs: T0 + 11 * 3600_000 - 20 * 60_000 }), newId)
  assert.equal(r.action, 'merged')
  assert.equal(r.workouts.find((w) => w.id === 'pm')?.garminId, 1)
  assert.equal(r.workouts.find((w) => w.id === 'am')?.garminId, undefined)
})

test('two sets cards with nothing inside the window → activity added, nothing guessed', () => {
  const a = setsCard('push', { id: 'a', startedAt: T0 - 10 * 3600_000 })
  const b = setsCard('pull', { id: 'b', startedAt: T0 + 10 * 3600_000 })
  const r = ingestGarminActivity([a, b], garminStrength(), newId)
  assert.equal(r.action, 'added')
  assert.equal(r.workouts.length, 3)
})

test('re-running sync is idempotent', () => {
  const first = ingestGarminActivity([setsCard('pull')], garminStrength(), newId)
  const again = ingestGarminActivity(first.workouts, garminStrength(), newId)
  assert.equal(again.action, 'unchanged')
  assert.equal(again.workouts.length, 1)
})

test('HEAL: Garmin synced first (shell) + separate sets card → folded into one on next sync', () => {
  // the exact 2026-08-22 duplicate
  const shell: MergeWorkout = { id: 'shell', garminId: 555001, type: 'strength', name: 'Strength', duration: 49, kcal: 555, avgHr: 138, maxHr: 167, startedAt: T0 }
  const recovery: MergeWorkout = { id: 'rec', garminId: 777, type: 'run', name: 'Recovery', duration: 5, kcal: 48 }
  const r = ingestGarminActivity([shell, recovery, setsCard('pull')], garminStrength(), newId)
  assert.equal(r.action, 'healed')
  assert.equal(r.workouts.length, 2)
  const pull = r.workouts.find((w) => w.type === 'pull')!
  assert.equal(pull.garminId, 555001)
  assert.equal(pull.duration, 49)
  assert.equal(pull.kcal, 555)
  assert.equal(pull.avgHr, 138)
  assert.equal(pull.sets?.length, 23)
  assert.equal(pull.name, null, 'title stays "Pull day"')
  assert.ok(r.workouts.find((w) => w.id === 'rec'), 'Recovery untouched')
  assert.ok(!r.workouts.find((w) => w.id === 'shell'), 'Garmin-only duplicate removed')
})

test('logSets adopts a Garmin-only shell when the watch synced first', () => {
  const shell: MergeWorkout = { id: 'shell', garminId: 1, type: 'strength', name: 'Strength', sets: [], startedAt: T0 }
  const recovery: MergeWorkout = { id: 'rec', garminId: 2, type: 'run', name: 'Recovery' }
  const pick = pickGarminShell([recovery, shell], T0 + 2 * 3600_000)
  assert.equal(pick?.id, 'shell')
  assert.equal(mergedName('pull', 'Strength', null), null)
  assert.equal(mergedName('strength', 'Strength', null), 'Strength')
})

test('shell already carrying sets is never adopted twice', () => {
  const used: MergeWorkout = { id: 'used', garminId: 1, type: 'pull', sets: sets(3), startedAt: T0 }
  assert.equal(pickGarminShell([used], T0), null)
})
