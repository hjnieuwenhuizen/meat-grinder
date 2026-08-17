<div align="center">

# 🥩 Meat Grinder

**Grind your macros. Hit your numbers.**

A dark, fast, opinionated macro & calorie tracker — built as a coach, not a food diary.

[**Live app →**](https://meat-grinder-88722.web.app)

![TypeScript](https://img.shields.io/badge/TypeScript-0b0f0d?logo=typescript&logoColor=35e07c)
![React](https://img.shields.io/badge/React_19-0b0f0d?logo=react&logoColor=35e07c)
![Vite](https://img.shields.io/badge/Vite_7-0b0f0d?logo=vite&logoColor=35e07c)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_v4-0b0f0d?logo=tailwindcss&logoColor=35e07c)
![Firebase](https://img.shields.io/badge/Firebase-0b0f0d?logo=firebase&logoColor=35e07c)
![Capacitor](https://img.shields.io/badge/Capacitor_8-0b0f0d?logo=capacitor&logoColor=35e07c)
![MCP](https://img.shields.io/badge/MCP_server-0b0f0d?logoColor=35e07c)
![PWA](https://img.shields.io/badge/PWA-installable-0b0f0d?logo=pwa&logoColor=35e07c)

</div>

---

## The philosophy

Most trackers drown you in data and reward the wrong things. Meat Grinder is built on three opinions:

1. **Protein is mandatory.** It's the one number you must hit. Overshooting is a win, never a warning.
2. **Calories govern the day** — judged against a ±10% band, not a razor edge.
3. **Carbs and fat are interchangeable energy levers.** They only go red when the *calorie budget* blows, because they trade against each other.

And one hard rule: **exercise never buys food.** Wearable calories are never eaten back 1:1. The one sanctioned exception is the **endurance fueling layer**: when a day's estimated burn clears 400 kcal, the goal grows by 60% of the excess (capped at +1000), added as carbs and labelled — a gym session adds ~0, an 18 km run adds ~670. Runs are estimated from physics (≈1 kcal × kg × km), not the watch's optimistic number.

## Features

### 🧠 Smart goals — honest by design
- A four-step wizard (you → lifestyle → diet style → pace) turns Mifflin-St Jeor BMR + a training-free lifestyle factor into macro targets for five diet styles, carnivore to high-carb — protein set separately in g/kg.
- **Guardrails with no lying**: preset paces prescribe at most a 20% deficit of maintenance (25% hard cap via explicit custom-kcal targets); the displayed kg/week is recomputed from the *actual* post-cap deficit; pace is sanity-checked as %-bodyweight/week; at high BMI protein and the fat floor scale from adjusted bodyweight so no one gets told to eat 280g protein.
- **Goal snapshots** — every day freezes the goals it was logged under. Retune whenever you like; history never rewrites.
- **Calibration closes the loop**: Reports compares your weight trend against the food-math and suggests maintenance corrections — the equation starts the plan, the scale finishes it.

### 🎯 Diary — the command centre
- Calorie hero with in-range band, macro rings, and **Today's Mission**: *"Eat 28g more protein. You have 315 kcal remaining."* Mission coaching is context-aware: tight fat budget → go-lean suggestions; short sleep or low training readiness → recovery first; big alcohol night → named, no punishment-cardio nonsense.
- **Estimated energy balance bar** — your intake plotted against today's actual burn with zones (extreme / weight loss / maintain / gain). Three thresholds, not two: above target but below burn is a *smaller deficit than planned*, never screamed at as "over". Red is reserved for a true surplus.
- **Fix it** — the protein gap calculator. One tap shows exact portions from *your* foods that close the gap within your remaining calories: `300g chicken breast — +51g P, 264 kcal`. No math.
- Live **"After adding"** preview while you log — see what any portion does to your day before committing.
- Meal slots (breakfast → evening snack) with per-meal macro subtotals, drag & drop between slots.
- **Workouts in the timeline** — push/legs/pull, run, ride, swim, hike, stairs, cardio — with duration, kcal, distance, heart rate, pace, elevation, placed *before or after* the meal you trained around. Logging one flips the day to training goals.
- **Live gym logging** — capture sets in the gym (exercise, kg, reps, warm-up and to-failure flags) against a shared, self-building exercise library with frecency autocomplete and one-tap "same again". When your watch syncs its strength activity it **merges onto the same card** (duration/kcal/HR attach, never a duplicate). Working volume excludes warm-ups.
- **Weigh-ins** — weight with optional body fat % and skeletal muscle, feeding the profile and the Reports body trend.
- **Sleep, steps, resting heart rate** — synced automatically; steps are Garmin-first (watch > phone Health Connect).
- **Alcohol logged in red with 🍺.** It counts, it shows, no hiding. Tracks grams of pure alcohol per drink.

### 🍲 Recipe box
Sectioned recipes that keep each component's ingredients *and* method together, with per-portion macros. **Cook mode** rescales the whole dish live when you change any ingredient amount; a shopping-list tab with checkboxes; JSON import with a copyable AI prompt so any assistant can digitise a recipe; log a cooked portion straight into today.

### ⌚ Garmin auto-sync — the full wellness picture
Connect your Garmin account in Settings — workouts (with HR, pace, elevation, cadence), sleep, steps and resting HR appear automatically every 3 hours and before every read, plus a 30-day backfill button. Beyond the basics it pulls **sleep score, overnight HRV + status, training readiness, body battery, stress, SpO₂, respiration, intensity minutes, floors and active calories** — shown as Diary pills and fed to the coaching. Steps are read from both Garmin endpoints (daily report *and* live summary) and take the max. Your password is exchanged for session tokens server-side and discarded; manual entries are never overwritten; a visible per-source **sync log** in Settings makes every run debuggable.

### 📱 Android app + Samsung Health
A thin Capacitor shell wraps the live web app (web deploys reach the installed app instantly) and adds native Google sign-in plus **Health Connect** steps sync — Samsung Health, Google Fit, any source. The APK builds in GitHub Actions; sideload it, no Play Store required.

### 🏆 Compete
Family leaderboards by invite code, an opt-in global board, an **all-time steps race** that never resets, and long-range challenges ("most steps Sep–Dec") across seven metrics. Scoring rewards *consistency against your own goals* — protein hits, in-range days, workouts, sleep, dry days — not who ate least. Leaderboards only ever see published scores, never anyone's diary.

### 🤖 Bring your own AI coach
- **MCP server** — connect Claude (or any MCP client) via a personal URL from Settings. 20+ tools: goals, days, ranges, foods, recipes, exercises, gym sets, weigh-ins, full diary CRUD.
- **GPT Actions API** — the same tools as REST + OpenAPI for custom GPTs (`/api/openapi.json`, keyed no-auth variant included). *"Log 2 scoops whey at lunch"* or *"bench 4×8 at 80"* → done, with updated totals in the reply.
- **`how_the_app_works`** — a built-in manual (also public at `/api/guide`) that teaches any AI the goal model, snapshot semantics, fueling rules and coaching etiquette before it opens its mouth.
- **Library hygiene endpoints** — an AI can audit the shared library (kcal-vs-macro drift, duplicates, label typos on branded items), present you a cleanup plan, and apply it after your confirmation — optionally retro-correcting diary entries logged from a fixed food without touching anything else.
- **Copy for LLM** — every view has a one-tap markdown export for any chat with no integrations.

### 🍗 Shared library
Foods, recipes and exercises live in **one shared library** — anything any user adds is available to everyone, with personal legacy data auto-published once. Diary entries bake macros in at log time, so a library edit never rewrites anyone's history.

### 📊 Reports that reward consistency
- Weekly & monthly: averages (kcal, protein, sleep, steps, resting HR), calories-vs-goal chart (same three-threshold colours as the diary), expandable per-day logs with workouts and sets.
- **Energy balance panel** — per-day eaten-vs-burn bars over logged days only (an unlogged day is missing data, not a deficit), with the implied weight change.
- **Body trend** — weigh-in dots with a 7-day rolling average, and the calibration verdict: does the scale agree with the food-math?
- **Compliance grid** — ✓/✕ per day for protein and calories, plus a training row. Habit score, not scale drama.

### 📲 Installable PWA
Add to home screen, auto-updating, safe-area aware, built mobile-first — with proper desktop layouts too.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) — app and Cloud Functions |
| UI | React 19, Tailwind CSS v4, custom dark theme |
| Build | Vite 7 + `vite-plugin-pwa` (auto-updating service worker) |
| Auth | Firebase Auth (Google sign-in; native account sheet in the Android shell) |
| Data | Cloud Firestore, owner-only security rules |
| Backend | Cloud Functions v2 — Garmin sync, MCP server, GPT Actions REST API |
| Android | Capacitor 8 shell + Health Connect, APK via GitHub Actions |
| Hosting | Firebase Hosting |

**No state library, no component kit, no CSS framework beyond Tailwind.** ~20 source files, one shared type model ([`src/types.ts`](src/types.ts)).

## Data model

```
users/{uid}/
  meta/settings          goals (rest + training day) + profile (the wizard's inputs)
  meta/garmin            Garmin sync status · meta/garminTokens (server-managed)
  meta/garminLog|healthLog  visible sync trails (last 20 runs per source)
  meta/mcp               personal LLM key · meta/family (compete membership)
  meta/library           one-time shared-library migration flag
  foods/{id} (legacy)    personal foods, kept readable forever
  days/{yyyy-mm-dd}      the diary: entries[], workouts[] (with sets),
                         training, sleep, steps, garmin wellness, body,
                         goals snapshot (frozen at log time)
foods/{id}               SHARED food library — per-100g/ml or per-scoop/unit,
                         frecency, alcohol flag + grams
recipes/{id}             SHARED recipes — sections (ingredients + method), portions
exercises/{slug}         SHARED self-building exercise library, frecency-ranked
families/{code}          compete groups: members, scores, challenges
globalUsers, globalScores  opt-in global leaderboard
garminUsers/{uid}        sync registry · mcpKeys/{key} LLM key index (server-only)
```

Entries are **denormalized** — macros are baked in at log time, so editing a library food never rewrites history. Leaderboards only ever see published daily scores, never the diary itself.

## Run your own

The repo carries no project config — you point it at your own Firebase project.

**1. Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com), then enable:
- **Authentication** → Sign-in method → **Google**
- **Firestore** (production mode — the rules in this repo lock data to its owner)

**2. Register a web app** (Project settings → Your apps → Web) and copy its config:

```bash
git clone https://github.com/hjnieuwenhuizen/meat-grinder.git && cd meat-grinder
npm install
cp .env.example .env.local        # paste your Firebase web config values here
```

**3. Link the Firebase CLI to your project:**

```bash
npm i -g firebase-tools
firebase login
firebase use --add                # select your project → creates your .firebaserc
```

**4. Run and ship:**

```bash
npm run dev                                        # local dev
npm run build
firebase deploy --only hosting,firestore:rules     # live
```

**5. Backend features (optional)** — Garmin sync, MCP server and the GPT Actions API need the Blaze plan (free at this scale):

```bash
firebase deploy --only functions
```

Users connect Garmin in-app (Settings → Garmin). Garmin rate-limits logins from cloud IPs, so a rejected connect is saved and retried automatically every sync cycle (credentials are deleted the moment login succeeds). Impatient users can generate tokens locally with the script the app serves at `/garmin-token.mjs`.

**6. Android APK (optional)** — register an Android app in Firebase (`com.meatgrinder.app` → your own id), drop `google-services.json` into `android/app/`, add your keystore SHA-1, and the [GitHub Action](.github/workflows/android-apk.yml) builds the APK on every push.

## Design notes

- Palette: charcoal ink `#0b0f0d`, bone text, **grind green `#35e07c`** — with amber/coral reserved for meaning (under / over), never decoration.
- Space Grotesk throughout; tabular numerals for every number that changes.
- Colour is the coaching language: the app tells you how the day is going before you read a single digit.

---

<div align="center">
Built with 🥩 and an unreasonable amount of chicken breast.
</div>
