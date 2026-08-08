// MCP server — lets an LLM (Claude, etc.) query the user's diary live.
// Auth: personal secret key in the URL path (/mcp/<key>), generated in
// Settings. Key → uid lookup lives in the server-only `mcpKeys` collection.
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

if (!getApps().length) initializeApp()
const db = getFirestore()

const REGION = 'europe-west1'

interface Macros {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

interface Entry extends Macros {
  name: string
  amount?: number | null
  unit?: string | null
  grams?: number | null
  meal?: string | null
  alcohol?: boolean
  alcoholG?: number | null
}

interface Workout {
  type: string
  name?: string | null
  duration?: number | null
  kcal?: number | null
  distance?: number | null
  meal?: string | null
  when?: string
}

interface DayDoc {
  training: boolean
  entries: Entry[]
  workouts: Workout[]
  sleep?: number | null
  garmin?: { steps?: number | null; restingHr?: number | null }
}

const totalsOf = (entries: Entry[]): Macros =>
  entries.reduce(
    (t, e) => ({
      kcal: t.kcal + e.kcal,
      protein: t.protein + e.protein,
      carbs: t.carbs + e.carbs,
      fat: t.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

const round = (m: Macros): Macros => ({
  kcal: Math.round(m.kcal),
  protein: Math.round(m.protein * 10) / 10,
  carbs: Math.round(m.carbs * 10) / 10,
  fat: Math.round(m.fat * 10) / 10,
})

const daySummary = (date: string, day: DayDoc, settings: Record<string, unknown>) => {
  const totals = round(totalsOf(day.entries))
  const trainingEnabled = Boolean(settings.trainingEnabled)
  const goal = (trainingEnabled && day.training ? settings.training : settings.rest) as Macros | undefined
  const alcohol = day.entries.filter((e) => e.alcohol)
  return {
    date,
    trainingDay: day.training,
    goal: goal ?? null,
    totals,
    sleepHours: day.sleep ?? null,
    steps: day.garmin?.steps ?? null,
    restingHeartRate: day.garmin?.restingHr ?? null,
    alcohol: alcohol.length
      ? {
          kcal: Math.round(alcohol.reduce((s, e) => s + e.kcal, 0)),
          pureAlcoholGrams: Math.round(alcohol.reduce((s, e) => s + (e.alcoholG || 0), 0)),
        }
      : null,
    workouts: day.workouts.map((w) => ({
      type: w.type,
      name: w.name ?? null,
      minutes: w.duration ?? null,
      kcalBurned: w.kcal ?? null,
      distanceKm: w.distance ?? null,
      slot: w.meal ?? null,
      when: w.when ?? null,
    })),
  }
}

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] })

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/

function buildServer(uid: string): McpServer {
  const server = new McpServer({ name: 'meat-grinder', version: '1.0.0' })

  const loadDay = async (date: string): Promise<DayDoc> => {
    const snap = await db.doc(`users/${uid}/days/${date}`).get()
    return { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc> | undefined) }
  }
  const loadSettings = async () =>
    (await db.doc(`users/${uid}/meta/settings`).get()).data() ?? {
      trainingEnabled: false,
      rest: { kcal: 2200, protein: 180, carbs: 200, fat: 70 },
    }

  server.registerTool(
    'get_goals',
    { description: "The user's daily macro goals (rest day and, if enabled, training day). Protein is a hard target; carbs/fat are flexible; exercise burn is never added back to the calorie budget." },
    async () => text(await loadSettings()),
  )

  server.registerTool(
    'get_day',
    {
      description: 'Full diary for one day: every food entry (with meal slot, amounts, macros, alcohol flags), workouts, sleep, steps, resting heart rate, totals and goals.',
      inputSchema: { date: z.string().regex(DATE_RX).describe('Date as YYYY-MM-DD') },
    },
    async ({ date }) => {
      const [day, settings] = await Promise.all([loadDay(date), loadSettings()])
      return text({
        ...daySummary(date, day, settings),
        entries: day.entries.map((e) => ({
          name: e.name,
          amount: e.amount ?? e.grams ?? null,
          unit: e.unit ?? (e.grams != null ? 'g' : null),
          mealSlot: e.meal ?? null,
          alcohol: e.alcohol ?? false,
          ...round(e),
        })),
      })
    },
  )

  server.registerTool(
    'get_range',
    {
      description: 'Per-day summaries (totals, goals, sleep, steps, resting HR, workouts, alcohol) plus averages over a date range. Use for weekly/monthly reviews and trends. Max 62 days.',
      inputSchema: {
        start_date: z.string().regex(DATE_RX).describe('First day, YYYY-MM-DD'),
        end_date: z.string().regex(DATE_RX).describe('Last day, YYYY-MM-DD (inclusive)'),
      },
    },
    async ({ start_date, end_date }) => {
      const snap = await db
        .collection(`users/${uid}/days`)
        .orderBy('__name__')
        .startAt(start_date)
        .endAt(end_date)
        .limit(62)
        .get()
      const settings = await loadSettings()
      const days = snap.docs.map((d) =>
        daySummary(d.id, { training: false, entries: [], workouts: [], ...(d.data() as Partial<DayDoc>) }, settings),
      )
      const logged = days.filter((d) => d.totals.kcal > 0)
      const avg = logged.length
        ? round({
            kcal: logged.reduce((s, d) => s + d.totals.kcal, 0) / logged.length,
            protein: logged.reduce((s, d) => s + d.totals.protein, 0) / logged.length,
            carbs: logged.reduce((s, d) => s + d.totals.carbs, 0) / logged.length,
            fat: logged.reduce((s, d) => s + d.totals.fat, 0) / logged.length,
          })
        : null
      return text({ days, daysLogged: logged.length, averagesOverLoggedDays: avg })
    },
  )

  server.registerTool(
    'search_foods',
    {
      description: "Search the user's personal food/drink library (macros per 100g/ml or per scoop/unit).",
      inputSchema: { query: z.string().describe('Case-insensitive substring of the food name; empty returns everything (max 30)') },
    },
    async ({ query }) => {
      const snap = await db.collection(`users/${uid}/foods`).orderBy('name').get()
      const q = query.toLowerCase()
      const foods = snap.docs
        .map((d) => d.data())
        .filter((f) => String(f.name ?? '').toLowerCase().includes(q))
        .slice(0, 30)
      return text(foods)
    },
  )

  return server
}

export const mcp = onRequest({ region: REGION, memory: '256MiB', timeoutSeconds: 120 }, async (req, res) => {
  // key is the last path segment: /mcp/<key> (hosting rewrite) or /<key> (direct)
  const segments = req.path.split('/').filter((s) => s && s !== 'mcp')
  const key = segments[segments.length - 1]
  const keySnap = key && /^[a-f0-9]{48}$/.test(key) ? await db.doc(`mcpKeys/${key}`).get() : null
  const uid = keySnap?.exists ? (keySnap.data() as { uid: string }).uid : null

  if (!uid) {
    res.status(401).json({ error: 'Invalid or missing MCP key. Generate one in Meat Grinder → Settings.' })
    return
  }

  if (req.method !== 'POST') {
    // stateless server: no SSE stream or session teardown to offer
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. POST JSON-RPC messages to this endpoint.' },
      id: null,
    })
    return
  }

  try {
    const server = buildServer(uid)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) {
    logger.error('MCP request failed', e)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
})

export const mcpKeyGenerate = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')

  // revoke any previous key
  const existing = await db.doc(`users/${uid}/meta/mcp`).get()
  const oldKey = (existing.data() as { key?: string } | undefined)?.key
  if (oldKey) await db.doc(`mcpKeys/${oldKey}`).delete()

  const key = crypto.randomBytes(24).toString('hex')
  await db.doc(`mcpKeys/${key}`).set({ uid, createdAt: Date.now() })
  await db.doc(`users/${uid}/meta/mcp`).set({ key, createdAt: Date.now() })
  return { ok: true, key }
})

export const mcpKeyRevoke = onCall({ region: REGION }, async (req) => {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  const existing = await db.doc(`users/${uid}/meta/mcp`).get()
  const oldKey = (existing.data() as { key?: string } | undefined)?.key
  if (oldKey) await db.doc(`mcpKeys/${oldKey}`).delete()
  await db.doc(`users/${uid}/meta/mcp`).delete()
  return { ok: true }
})
