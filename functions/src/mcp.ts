// LLM integrations — two doors into the same read-only data:
//  1. MCP server (Streamable HTTP) for Claude / ChatGPT connectors: /mcp/<key>
//  2. REST + OpenAPI for custom GPT "Actions": /api/* with X-API-Key header
// Both authenticate with the personal key generated in Settings
// (users/{uid}/meta/mcp, indexed server-side in `mcpKeys`).
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
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/

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

/* ---------- shared payload builders (used by MCP tools AND the REST api) ---------- */

const loadDay = async (uid: string, date: string): Promise<DayDoc> => {
  const snap = await db.doc(`users/${uid}/days/${date}`).get()
  return { training: false, entries: [], workouts: [], ...(snap.data() as Partial<DayDoc> | undefined) }
}

const loadSettings = async (uid: string) =>
  (await db.doc(`users/${uid}/meta/settings`).get()).data() ?? {
    trainingEnabled: false,
    rest: { kcal: 2200, protein: 180, carbs: 200, fat: 70 },
  }

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

const goalsPayload = (uid: string) => loadSettings(uid)

const dayPayload = async (uid: string, date: string) => {
  const [day, settings] = await Promise.all([loadDay(uid, date), loadSettings(uid)])
  return {
    ...daySummary(date, day, settings),
    entries: day.entries.map((e) => ({
      name: e.name,
      amount: e.amount ?? e.grams ?? null,
      unit: e.unit ?? (e.grams != null ? 'g' : null),
      mealSlot: e.meal ?? null,
      alcohol: e.alcohol ?? false,
      ...round(e),
    })),
  }
}

const rangePayload = async (uid: string, start: string, end: string) => {
  const snap = await db
    .collection(`users/${uid}/days`)
    .orderBy('__name__')
    .startAt(start)
    .endAt(end)
    .limit(62)
    .get()
  const settings = await loadSettings(uid)
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
  return { days, daysLogged: logged.length, averagesOverLoggedDays: avg }
}

const foodsPayload = async (uid: string, query: string) => {
  const snap = await db.collection(`users/${uid}/foods`).orderBy('name').get()
  const q = query.toLowerCase()
  return snap.docs
    .map((d) => d.data())
    .filter((f) => String(f.name ?? '').toLowerCase().includes(q))
    .slice(0, 30)
}

const uidForKey = async (key: string | undefined | null): Promise<string | null> => {
  if (!key || !/^[a-f0-9]{48}$/.test(key)) return null
  const snap = await db.doc(`mcpKeys/${key}`).get()
  return snap.exists ? (snap.data() as { uid: string }).uid : null
}

/* ---------- MCP server ---------- */

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] })

function buildServer(uid: string): McpServer {
  const server = new McpServer({ name: 'meat-grinder', version: '1.0.0' })

  server.registerTool(
    'get_goals',
    { description: "The user's daily macro goals (rest day and, if enabled, training day). Protein is a hard target; carbs/fat are flexible; exercise burn is never added back to the calorie budget." },
    async () => text(await goalsPayload(uid)),
  )

  server.registerTool(
    'get_day',
    {
      description: 'Full diary for one day: every food entry (with meal slot, amounts, macros, alcohol flags), workouts, sleep, steps, resting heart rate, totals and goals.',
      inputSchema: { date: z.string().regex(DATE_RX).describe('Date as YYYY-MM-DD') },
    },
    async ({ date }) => text(await dayPayload(uid, date)),
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
    async ({ start_date, end_date }) => text(await rangePayload(uid, start_date, end_date)),
  )

  server.registerTool(
    'search_foods',
    {
      description: "Search the user's personal food/drink library (macros per 100g/ml or per scoop/unit).",
      inputSchema: { query: z.string().describe('Case-insensitive substring of the food name; empty returns everything (max 30)') },
    },
    async ({ query }) => text(await foodsPayload(uid, query)),
  )

  return server
}

export const mcp = onRequest({ region: REGION, memory: '256MiB', timeoutSeconds: 120 }, async (req, res) => {
  // key is the last path segment: /mcp/<key> (hosting rewrite) or /<key> (direct)
  const segments = req.path.split('/').filter((s) => s && s !== 'mcp')
  const uid = await uidForKey(segments[segments.length - 1])

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

/* ---------- REST + OpenAPI for custom GPT Actions ---------- */

const openApiSchema = (host: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'Meat Grinder diary',
    description:
      "Read-only access to the user's nutrition diary. Protein is a hard daily target; carbs/fat are flexible against the calorie budget; exercise burn is never added back to the budget.",
    version: '1.0.0',
  },
  servers: [{ url: `https://${host}/api` }],
  security: [{ ApiKeyAuth: [] }],
  components: {
    schemas: {},
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },
  paths: {
    '/goals': {
      get: {
        operationId: 'getGoals',
        summary: 'Daily macro goals (rest + training day)',
        responses: { '200': { description: 'Goals', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/day': {
      get: {
        operationId: 'getDay',
        summary: 'Full diary for one day: entries, workouts, sleep, steps, resting HR, totals, goals',
        parameters: [
          { name: 'date', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
        ],
        responses: { '200': { description: 'Day diary', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/range': {
      get: {
        operationId: 'getRange',
        summary: 'Per-day summaries and averages over a date range (max 62 days)',
        parameters: [
          { name: 'start', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
          { name: 'end', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD inclusive' },
        ],
        responses: { '200': { description: 'Range summary', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
    '/foods': {
      get: {
        operationId: 'searchFoods',
        summary: "Search the user's food/drink library",
        parameters: [
          { name: 'query', in: 'query', required: false, schema: { type: 'string' }, description: 'Substring of food name' },
        ],
        responses: { '200': { description: 'Foods', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
      },
    },
  },
})

export const api = onRequest({ region: REGION, memory: '256MiB', timeoutSeconds: 60 }, async (req, res) => {
  const path = (req.path.startsWith('/api') ? req.path.slice(4) : req.path) || '/'

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' })
    return
  }

  // schema is public — it contains no data or secrets
  if (path === '/openapi.json') {
    // behind the hosting rewrite the original domain arrives via x-forwarded-host
    const host = req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host') || 'localhost'
    res.json(openApiSchema(host))
    return
  }

  const headerKey = req.get('x-api-key') ?? req.get('authorization')?.replace(/^Bearer\s+/i, '')
  const uid = await uidForKey(headerKey?.trim())
  if (!uid) {
    res.status(401).json({ error: 'Invalid or missing X-API-Key. Generate one in Meat Grinder → Settings.' })
    return
  }

  try {
    if (path === '/goals') {
      res.json(await goalsPayload(uid))
    } else if (path === '/day') {
      const date = String(req.query.date ?? '')
      if (!DATE_RX.test(date)) {
        res.status(400).json({ error: 'date must be YYYY-MM-DD' })
        return
      }
      res.json(await dayPayload(uid, date))
    } else if (path === '/range') {
      const start = String(req.query.start ?? '')
      const end = String(req.query.end ?? '')
      if (!DATE_RX.test(start) || !DATE_RX.test(end)) {
        res.status(400).json({ error: 'start and end must be YYYY-MM-DD' })
        return
      }
      res.json(await rangePayload(uid, start, end))
    } else if (path === '/foods') {
      res.json(await foodsPayload(uid, String(req.query.query ?? '')))
    } else {
      res.status(404).json({ error: 'Unknown endpoint. See /api/openapi.json' })
    }
  } catch (e) {
    logger.error('REST api request failed', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/* ---------- key management ---------- */

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
