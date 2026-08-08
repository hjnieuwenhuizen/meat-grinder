# AGENTS.md — rules for AI agents working on Meat Grinder

## What this is

A macro/calorie tracker PWA. **TypeScript**, React 19 + Vite + Tailwind v4 on Firebase (Google auth, Firestore, Hosting, Cloud Functions). Single deployed instance at https://meat-grinder-88722.web.app.

## Commands

```bash
npm run dev                      # dev server (port 5173)
npm run typecheck                # tsc --noEmit
npm run build                    # typecheck + production build → dist/
firebase deploy --only hosting   # ship the app
firebase deploy --only functions # ship Garmin sync (functions/src, tsc runs on predeploy)
firebase deploy --only firestore:rules
```

## Architecture in 30 seconds

- `src/types.ts` — the data model (`Food`, `Entry`, `Workout`, `DayDoc`, `Settings`, `ScoreDoc`, `ChallengeDoc`). Start here.
- `src/hooks/useData.ts` — diary/library Firestore access. Day docs at `users/{uid}/days/{yyyy-mm-dd}` hold `entries[]` (food), `workouts[]` (with Garmin metrics: HR/pace/elevation/cadence), `training`, `sleep`, `steps`, `garmin` wellness. Foods at `users/{uid}/foods/{id}`, goals at `users/{uid}/meta/settings`.
- Entries are **denormalized**: macros are baked into each entry at log time. Editing a food never rewrites history.
- `src/lib/` — pure helpers: `units.ts` (g/ml per-100 vs scoop/unit per-1), `meals.ts` (meal slots), `workouts.ts` (types, titles, metric formatting), `score.ts` (Compete daily scoring), `llm.ts` (Copy-for-LLM report builders), `dates.ts`.
- Tabs: Diary (`Today.tsx`), Compete (`Compete.tsx` + `useFamily.ts` — family/global leaderboards, challenges), Reports, Library (`Foods.tsx`), Settings (`Goals.tsx` — goals, Garmin, phone health, LLM connection panels). Hash-routed (`#diary` …).
- `functions/src/index.ts` — Garmin sync: per-user tokens in `users/{uid}/meta/garminTokens`, registry `garminUsers/{uid}`, scheduled every 3h + callables (`garminConnect`, `garminSyncUser` with 30-day `full` resync, `garminDisconnect`). Rate-limited connects park credentials in `meta/garminPending` (deleted on first success).
- `functions/src/mcp.ts` — LLM access, one key per user (Settings → LLM connection, index in server-only `mcpKeys/{key}`): MCP server at `/mcp/<key>` and REST + OpenAPI for GPT Actions at `/api/*` (header key or keyed `/api/k/<key>/…` no-auth variant). Tools: goals/day/range/foods reads, `log_food`, `add_food`, `update_food`. Both share the same payload builders — extend those, not one side.
- Android shell: Capacitor 8 (`capacitor.config.ts`, `android/`) loading the **live** hosted app via `server.url`; `src/hooks/useHealth.ts` reads Health Connect steps (native only). APK built by `.github/workflows/android-apk.yml`; committed debug keystore keeps the Firebase SHA-1 stable. Compiled functions land in `functions/lib/` on deploy.

## Product rules — do not violate

1. **Protein is a hard target; carbs/fat are flexible.** Never flag carbs or fat red on their own line — only when total calories blow the budget (>+5%). Protein over target is a win (green), never red.
2. **Calories govern the day** via a ±10% band: amber under 90%, green 90–110%, red above 110%.
3. **Exercise burn is never added back to the calorie budget.** Workout kcal is informational only. No eat-back calories, ever.
4. **Alcohol shows in red with 🍺, no softening.** It counts toward calories and totals.
5. **Sync never overwrites manual input** (e.g. Garmin sleep only fills empty days; workouts dedupe by `garminId`).
6. **Every feature must be represented in the Copy-for-LLM output** (`src/lib/llm.ts`) **and the MCP/Actions payloads** (`functions/src/mcp.ts`). If you add data, add it to the reports and the API.
7. **Compete never exposes the diary.** Leaderboards read only published `ScoreDoc`s (points/steps/km) — never entries, macros or weights of other users.

## Engineering rules

- TypeScript strict mode, no `any`. Types live in `src/types.ts` — extend them there, never inline duplicate shapes.
- Keep it simple. No new dependencies without strong justification; no state libraries, no CSS frameworks beyond Tailwind, no backend beyond the existing functions.
- Dark theme only. Use the tokens in `src/index.css` (`ink/panel/raise/edge/mist/bone/grind/protein/carbs/fat/over`) — never hardcode hex in components.
- Hooks before early returns — this codebase shipped a blank-screen bug from a `useMemo` after an early `return`. Don't repeat it.
- All forms submit on Enter (`<form onSubmit>`); every non-submit button inside a form needs `type="button"`.
- Modals: never close on backdrop click; pinned to top on mobile (keyboard space); ✕ to close.
- Mobile first: safe-area insets, ≥16px font in inputs (iOS zoom), bottom nav.
- Legacy data shapes must keep working: old entries use `grams`, new ones `amount`+`unit` (see `units.js` helpers); day docs may lack `workouts`/`sleep`.
- After UI changes: `npm run build` must pass before deploying. Deploy hosting after every accepted change.

## Do not

- Do not store Garmin (or any) passwords beyond the pending-connect flow: credentials may sit in `users/{uid}/meta/garminPending` (owner-only) while Garmin rate-limits our IP, and MUST be deleted on the first successful login or on bad credentials. Never widen this.
- Do not commit secrets or personal deployment config. Firebase web config comes from `.env.local` (gitignored, template in `.env.example`); `.firebaserc` is gitignored — never hardcode project ids in source.
- Do not add weight tracking, AI coaching, or activity-based carb presets without being asked — considered and deliberately deferred.
- Do not loosen Firestore rules: user data is owner-only (`request.auth.uid == uid`).
- Do not switch the timezone handling without a plan: day keys are currently computed in Africa/Johannesburg (client uses local time; functions pin TZ).

## User preferences (owner)

- Extremely short, to-the-point communication. No walls of text.
- Simple solutions over clever ones. Green accents. Agency-level UI polish.
