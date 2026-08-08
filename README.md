<div align="center">

# 🥩 Meat Grinder

**Grind your macros. Hit your numbers.**

A dark, fast, opinionated macro & calorie tracker — built as a coach, not a food diary.

[**Live app →**](https://meat-grinder-88722.web.app)

![React](https://img.shields.io/badge/React_19-0b0f0d?logo=react&logoColor=35e07c)
![Vite](https://img.shields.io/badge/Vite_7-0b0f0d?logo=vite&logoColor=35e07c)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_v4-0b0f0d?logo=tailwindcss&logoColor=35e07c)
![Firebase](https://img.shields.io/badge/Firebase-0b0f0d?logo=firebase&logoColor=35e07c)
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

### 🎯 Today — the command centre
- Calorie hero with in-range band, macro rings, and **Today's Mission**: *"Eat 28g more protein. You have 315 kcal remaining."*
- **Fix it** — the protein gap calculator. One tap shows exact portions from *your* foods that close the gap within your remaining calories: `300g chicken breast — +51g P, 264 kcal`. No math.
- Live **"After adding"** preview while you log — see what any portion does to your day before committing.

### 📔 A real daily diary
- Meal slots (breakfast → evening snack) with per-meal macro subtotals, drag & drop between slots.
- **Workouts in the timeline** — Push / Legs / Pull / Run with duration, kcal, distance, placed *before or after* the meal you trained around. Logging one flips the day to training goals.
- **Sleep** — one field, done.
- **Alcohol logged in red with 🍺.** It counts, it shows, no hiding. Tracks grams of pure alcohol per drink.

### ⌚ Garmin auto-sync
Connect your Garmin account in settings — sleep and workouts appear automatically every 3 hours. Your password is exchanged for session tokens server-side and discarded; manual entries are never overwritten.

### 📊 Reports that reward consistency
- Weekly & monthly: averages, calories-vs-goal chart, expandable per-day food logs.
- **Compliance grid** — ✓/✕ per day for protein and calories, plus a training row. Habit score, not scale drama.

### 🤖 Copy for LLM
Every view has a one-tap **Copy for LLM** button producing clean markdown — goals, totals, per-meal entries, workouts, sleep, alcohol. Paste into any AI chat and it becomes your nutrition coach with full context.

### 📱 Installable PWA
Add to home screen, auto-updating, safe-area aware, built mobile-first.

## Stack

| Layer | Choice |
|---|---|
| UI | React 19, Tailwind CSS v4, custom dark theme |
| Build | Vite 7 + `vite-plugin-pwa` (auto-updating service worker) |
| Auth | Firebase Auth (Google sign-in) |
| Data | Cloud Firestore, owner-only security rules |
| Backend | Cloud Functions v2 (scheduled Garmin sync + callables) |
| Hosting | Firebase Hosting |

**No state library, no component kit, no CSS framework beyond Tailwind.** ~15 source files.

## Data model

```
users/{uid}/
  meta/settings          goals (rest + optional training day), preferences
  meta/garmin            sync status
  meta/garminTokens      Garmin session tokens (server-managed)
  foods/{id}             your food library — per-100g/ml or per-scoop/unit,
                         usage frecency, alcohol flag + grams
  days/{yyyy-mm-dd}      the diary: entries[], workouts[], training, sleep
garminUsers/{uid}        sync registry
```

Entries are **denormalized** — macros are baked in at log time, so editing a library food never rewrites history.

## Running it yourself

```bash
git clone <this repo> && cd meat-grinder
npm install
# 1. Create a Firebase project; enable Google auth + Firestore
# 2. Replace the config in src/lib/firebase.js and .firebaserc
npm run dev                            # local dev
npm run build && firebase deploy       # ship it
```

Garmin sync (optional) needs the Blaze plan: `firebase deploy --only functions`. If Garmin rate-limits cloud logins, `node functions/bootstrap.js` generates tokens locally to paste into the app.

## Design notes

- Palette: charcoal ink `#0b0f0d`, bone text, **grind green `#35e07c`** — with amber/coral reserved for meaning (under / over), never decoration.
- Space Grotesk throughout; tabular numerals for every number that changes.
- Colour is the coaching language: the app tells you how the day is going before you read a single digit.

---

<div align="center">
Built with 🥩 and an unreasonable amount of chicken breast.
</div>
