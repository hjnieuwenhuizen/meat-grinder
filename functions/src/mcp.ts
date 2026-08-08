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
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((f) => String((f as { name?: unknown }).name ?? '').toLowerCase().includes(q))
    .slice(0, 30)
}

/* ---------- food writes (add + edit the library) ---------- */

const UNITS = ['g', 'ml', 'scoop', 'unit']

// whitelist + coerce; `partial` skips fields that weren't provided
const sanitizeFood = (input: Record<string, unknown>, partial = false) => {
  const out: Record<string, unknown> = {}
  const has = (k: string) => input[k] !== undefined
  if (has('name')) out.name = String(input.name).trim().slice(0, 100)
  if (has('unit')) out.unit = UNITS.includes(String(input.unit)) ? String(input.unit) : 'g'
  for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) {
    if (has(k)) out[k] = Math.max(0, Number(input[k]) || 0)
  }
  if (has('serving')) out.serving = Number(input.serving) > 0 ? Number(input.serving) : null
  if (has('alcohol')) out.alcohol = Boolean(input.alcohol)
  if (has('alcoholG')) out.alcoholG = Number(input.alcoholG) > 0 ? Number(input.alcoholG) : null
  if (!partial) {
    if (!out.name) throw new Error('name is required')
    if (out.kcal === undefined) throw new Error('kcal is required')
    out.unit = out.unit ?? 'g'
    out.protein = out.protein ?? 0
    out.carbs = out.carbs ?? 0
    out.fat = out.fat ?? 0
    out.serving = out.serving ?? null
    out.alcohol = out.alcohol ?? false
    out.alcoholG = out.alcoholG ?? null
  }
  return out
}

const foodCreate = async (uid: string, input: Record<string, unknown>) => {
  const food = sanitizeFood(input)
  const ref = db.collection(`users/${uid}/foods`).doc()
  await ref.set(food)
  return { ok: true, id: ref.id, food }
}

const foodUpdate = async (uid: string, id: string, input: Record<string, unknown>) => {
  const ref = db.doc(`users/${uid}/foods/${id}`)
  if (!(await ref.get()).exists) throw new Error(`No food with id ${id}`)
  const changes = sanitizeFood(input, true)
  if (!Object.keys(changes).length) throw new Error('No valid fields to update')
  await ref.update(changes)
  return { ok: true, id, changes }
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
      description: "Search the user's personal food/drink library (macros per 100g/ml or per scoop/unit). Returns ids usable with update_food.",
      inputSchema: { query: z.string().describe('Case-insensitive substring of the food name; empty returns everything (max 30)') },
    },
    async ({ query }) => text(await foodsPayload(uid, query)),
  )

  const foodFields = {
    unit: z.enum(['g', 'ml', 'scoop', 'unit']).optional().describe('g/ml → macros per 100; scoop/unit → macros per 1'),
    kcal: z.number().min(0).optional(),
    protein: z.number().min(0).optional().describe('grams'),
    carbs: z.number().min(0).optional().describe('grams'),
    fat: z.number().min(0).optional().describe('grams'),
    serving: z.number().positive().optional().describe('default portion in g/ml (per-100 foods only)'),
    alcohol: z.boolean().optional().describe('alcoholic drinks are shown in red and tracked'),
    alcoholG: z.number().min(0).optional().describe('grams of pure alcohol per basis'),
  }

  server.registerTool(
    'add_food',
    {
      description: "Add a food or drink to the user's library. Macros are per 100 for unit g/ml, per 1 for scoop/unit.",
      inputSchema: { name: z.string().min(1), ...foodFields, kcal: z.number().min(0) },
    },
    async (input) => text(await foodCreate(uid, input as Record<string, unknown>)),
  )

  server.registerTool(
    'update_food',
    {
      description: 'Edit an existing library food. Get the id from search_foods. Only provided fields change.',
      inputSchema: { id: z.string().min(1), name: z.string().min(1).optional(), ...foodFields },
    },
    async ({ id, ...changes }) => text(await foodUpdate(uid, id, changes as Record<string, unknown>)),
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

const MACROS_SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
  },
}

const WORKOUT_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    name: { type: ['string', 'null'] },
    minutes: { type: ['number', 'null'] },
    kcalBurned: { type: ['number', 'null'] },
    distanceKm: { type: ['number', 'null'] },
    slot: { type: ['string', 'null'] },
    when: { type: ['string', 'null'] },
  },
}

const DAY_SUMMARY_PROPS = {
  date: { type: 'string' },
  trainingDay: { type: 'boolean' },
  goal: { ...MACROS_SCHEMA, type: ['object', 'null'] },
  totals: MACROS_SCHEMA,
  sleepHours: { type: ['number', 'null'] },
  steps: { type: ['number', 'null'] },
  restingHeartRate: { type: ['number', 'null'] },
  alcohol: {
    type: ['object', 'null'],
    properties: { kcal: { type: 'number' }, pureAlcoholGrams: { type: 'number' } },
  },
  workouts: { type: 'array', items: WORKOUT_SCHEMA },
}

const FOOD_INPUT_PROPS = {
  name: { type: 'string', description: 'Food or drink name' },
  unit: { type: 'string', enum: ['g', 'ml', 'scoop', 'unit'], description: 'g/ml → macros per 100; scoop/unit → macros per 1' },
  kcal: { type: 'number' },
  protein: { type: 'number', description: 'grams' },
  carbs: { type: 'number', description: 'grams' },
  fat: { type: 'number', description: 'grams' },
  serving: { type: ['number', 'null'], description: 'default portion in g/ml (per-100 foods only)' },
  alcohol: { type: 'boolean', description: 'alcoholic drinks are shown in red and tracked' },
  alcoholG: { type: ['number', 'null'], description: 'grams of pure alcohol per basis' },
}

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
        responses: {
          '200': {
            description: 'Goals',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    trainingEnabled: { type: 'boolean' },
                    rest: MACROS_SCHEMA,
                    training: MACROS_SCHEMA,
                  },
                },
              },
            },
          },
        },
      },
    },
    '/day': {
      get: {
        operationId: 'getDay',
        summary: 'Full diary for one day: entries, workouts, sleep, steps, resting HR, totals, goals',
        parameters: [
          { name: 'date', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY-MM-DD' },
        ],
        responses: {
          '200': {
            description: 'Day diary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ...DAY_SUMMARY_PROPS,
                    entries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          amount: { type: ['number', 'null'] },
                          unit: { type: ['string', 'null'] },
                          mealSlot: { type: ['string', 'null'] },
                          alcohol: { type: 'boolean' },
                          ...MACROS_SCHEMA.properties,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
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
        responses: {
          '200': {
            description: 'Range summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    days: { type: 'array', items: { type: 'object', properties: DAY_SUMMARY_PROPS } },
                    daysLogged: { type: 'number' },
                    averagesOverLoggedDays: { ...MACROS_SCHEMA, type: ['object', 'null'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/foods': {
      post: {
        operationId: 'addFood',
        summary: "Add a food or drink to the user's library (macros per 100 for g/ml, per 1 for scoop/unit)",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name', 'kcal'], properties: FOOD_INPUT_PROPS },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created food',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, id: { type: 'string' }, food: { type: 'object', properties: FOOD_INPUT_PROPS } },
                },
              },
            },
          },
        },
      },
      get: {
        operationId: 'searchFoods',
        summary: "Search the user's food/drink library (returns ids usable with updateFood)",
        parameters: [
          { name: 'query', in: 'query', required: false, schema: { type: 'string' }, description: 'Substring of food name' },
        ],
        responses: {
          '200': {
            description: 'Foods',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      unit: { type: ['string', 'null'] },
                      serving: { type: ['number', 'null'] },
                      alcohol: { type: ['boolean', 'null'] },
                      alcoholG: { type: ['number', 'null'] },
                      ...MACROS_SCHEMA.properties,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/foods/{id}': {
      patch: {
        operationId: 'updateFood',
        summary: 'Edit an existing library food — only provided fields change. Get the id from searchFoods.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Food id from searchFoods' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: FOOD_INPUT_PROPS },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated food',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, id: { type: 'string' }, changes: { type: 'object', properties: FOOD_INPUT_PROPS } },
                },
              },
            },
          },
        },
      },
    },
  },
})

export const api = onRequest({ region: REGION, memory: '256MiB', timeoutSeconds: 60 }, async (req, res) => {
  const path = (req.path.startsWith('/api') ? req.path.slice(4) : req.path) || '/'

  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // schema is public — it contains no data or secrets
  if (req.method === 'GET' && path === '/openapi.json') {
    // behind the hosting rewrite the original domain arrives via x-forwarded-host
    const host = req.get('x-forwarded-host')?.split(',')[0].trim() || req.get('host') || 'localhost'
    res.json(openApiSchema(host))
    return
  }

  const headerKey = req.get('x-api-key') ?? req.get('authorization')?.replace(/^(Bearer|Basic)\s+/i, '')
  const uid = await uidForKey(headerKey?.trim())
  if (!uid) {
    // diagnostic: log the shape of what arrived, never the value itself
    logger.info(
      `api auth failed: ${req.method} ${path} ua="${req.get('user-agent')?.slice(0, 60)}" ` +
      `xApiKey=${req.get('x-api-key') ? `len ${req.get('x-api-key')!.trim().length}` : 'absent'} ` +
      `authHeader=${req.get('authorization') ? `"${req.get('authorization')!.slice(0, 10)}…"` : 'absent'}`,
    )
    res.status(401).json({ error: 'Invalid or missing X-API-Key. Generate one in Meat Grinder → Settings.' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const foodIdMatch = path.match(/^\/foods\/([A-Za-z0-9]+)$/)

  try {
    if (req.method === 'POST' && path === '/foods') {
      try {
        res.json(await foodCreate(uid, body))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method === 'PATCH' && foodIdMatch) {
      try {
        res.json(await foodUpdate(uid, foodIdMatch[1], body))
      } catch (e) {
        res.status(400).json({ error: (e as Error).message })
      }
    } else if (req.method !== 'GET') {
      res.status(404).json({ error: 'Unknown endpoint. See /api/openapi.json' })
    } else if (path === '/goals') {
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
