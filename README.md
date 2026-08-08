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

And one hard rule: **exercise never buys food.** Burned calories are recorded, never added back to the budget. No eat-back fiction.

## Features

### 🎯 Diary — the command centre
- Calorie hero with in-range band, macro rings, and **Today's Mission**: *"Eat 28g more protein. You have 315 kcal remaining."*
- **Fix it** — the protein gap calculator. One tap shows exact portions from *your* foods that close the gap within your remaining calories: `300g chicken breast — +51g P, 264 kcal`. No math.
- Live **"After adding"** preview while you log — see what any portion does to your day before committing.
- Meal slots (breakfast → evening snack) with per-meal macro subtotals, drag & drop between slots.
- **Workouts in the timeline** — push/legs/pull, run, ride, swim, hike, stairs, cardio — with duration, kcal, distance, heart rate, pace, elevation, placed *before or after* the meal you trained around. Logging one flips the day to training goals.
- **Sleep, steps, resting heart rate** — one line, synced or typed.
- **Alcohol logged in red with 🍺.** It counts, it shows, no hiding. Tracks grams of pure alcohol per drink.

### ⌚ Garmin auto-sync
Connect your Garmin account in Settings — workouts (with HR, pace, elevation, cadence), sleep, steps and resting heart rate appear automatically every 3 hours, plus a 30-day backfill button. Your password is exchanged for session tokens server-side and discarded; manual entries are never overwritten.

### 📱 Android app + Samsung Health
A thin Capacitor shell wraps the live web app (web deploys reach the installed app instantly) and adds native Google sign-in plus **Health Connect** steps sync — Samsung Health, Google Fit, any source. The APK builds in GitHub Actions; sideload it, no Play Store required.

### 🏆 Compete
Family leaderboards by invite code, an opt-in global board, and long-range challenges ("most steps Sep–Dec") across seven metrics. Scoring rewards *consistency against your own goals* — protein hits, in-range days, workouts, sleep, dry days — not who ate least.

### 🤖 Bring your own AI coach
- **MCP server** — connect Claude (or any MCP client) via a personal URL from Settings: it can read your goals, days, ranges and library live, log meals, and add/edit foods.
- **GPT Actions API** — the same tools as REST + OpenAPI for custom GPTs (`/api/openapi.json`, keyed no-auth variant included). *"Log 2 scoops whey at lunch"* → done, with updated totals in the reply.
- **Copy for LLM** — every view has a one-tap markdown export for any chat with no integrations.

### 📊 Reports that reward consistency
- Weekly & monthly: averages (kcal, protein, sleep, steps, resting HR), calories-vs-goal chart, expandable per-day logs.
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
  meta/settings          goals (rest + optional training day)
  meta/garmin            Garmin sync status · meta/garminTokens (server-managed)
  meta/mcp               personal LLM key · meta/family (compete membership)
  foods/{id}             food/drink library — per-100g/ml or per-scoop/unit,
                         usage frecency, alcohol flag + grams
  days/{yyyy-mm-dd}      the diary: entries[], workouts[], training, sleep,
                         steps, garmin wellness
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
