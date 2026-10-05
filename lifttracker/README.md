# LiftTracker

A fast, offline-first workout logger. Zero build step — plain HTML, CSS and ES modules —
installable as a PWA on Android/iOS/desktop, with optional Google sign-in that syncs
routines, history and settings through Firebase (Firestore).

```
index.html            app shell + theme bootstrap
manifest.webmanifest  PWA manifest (standalone, maskable icon, shortcuts)
sw.js                 service worker: offline shell, runtime caching
css/app.css           design system (light/dark tokens, components)
js/main.js            routing, shell, store → view wiring
js/store.js           state, persistence (localStorage ⇄ Firestore), all domain actions
js/cloud.js           lazy Firebase loader (Auth + Firestore, persistent cache)
js/firebase-config.js project config + CLOUD_ENABLED flag
js/views/*            home · train · library · progress · settings · workout (active session)
js/components/*       picker, routine editor, session detail, exercise detail, plates, summary, charts
data/exercises.json   3,268-exercise catalogue (built by tools/build_assets.py)
firestore.rules       security rules (same as the original app; already deployed)
firebase.json         Firebase Hosting config
android/              Trusted Web Activity wrapper (Play Store–ready shell)
```

## Run locally

```bash
cd lifttracker
python3 -m http.server 8765
# open http://localhost:8765
```

Everything works without signing in: data lives in `localStorage` (`lt_*` keys). Signing in
moves that data into your account the first time and keeps every device in sync afterwards.

## Deploy (Firebase Hosting, recommended)

Hosting on the same Firebase project means the auth domain is already authorized.

```bash
npm i -g firebase-tools        # on a machine with Node
firebase login
firebase deploy --only hosting # → https://gen-lang-client-0529107446.web.app
```

### Google sign-in — authorized domains

Firebase only allows sign-in from domains on its allow-list. The project currently allows
`gen-lang-client-0529107446.firebaseapp.com`, `…web.app` and the AI Studio Cloud Run hosts.
To sign in from anywhere else (including `localhost` while developing), add the domain:

> Firebase console → **Authentication → Settings → Authorized domains → Add domain**

Until then, "Continue with Google" fails with `auth/unauthorized-domain` (the app shows a toast).

### Pointing at a different Firebase project

Paste the new config into `js/firebase-config.js`, set `firestoreDatabaseId` to `'(default)'`
(unless you created a named database) and deploy `firestore.rules` with
`firebase deploy --only firestore:rules`. Set `CLOUD_ENABLED = false` to ship a purely
on-device build with no sign-in UI.

## Data model (compatible with the original app)

| Collection                 | Doc id     | Notes                                                       |
| -------------------------- | ---------- | ----------------------------------------------------------- |
| `workout_templates/{id}`   | uuid       | routines; `order`, `lastPerformed`, per-exercise `restTime`, `notes` |
| `workout_history/{id}`     | uuid       | sessions; `unit`, `volume`, `records`, `prs[]`, set `type` (W/D/F) |
| `users/{uid}`              | uid        | name/email/photo, `unit`, `theme`, `favorites`, `bodyweight[]`, `settings{}` |
| `active_workouts/{uid}`    | uid        | in-progress session (resumes across devices)                |
| `custom_exercises/{id}`    | `custom-…` | user-created exercises                                      |

Weights are stored in the unit they were logged in; the UI converts on read.

## Import existing workouts

**Settings → Data → Import** (also in the Progress ⋯ menu and the Train ⋯ menu).

| File | What it is | Notes |
| --- | --- | --- |
| `.json` LiftTracker backup | from **Settings → Data → Export backup** | restores history, routines, custom exercises, favorites, body weight |
| `.json` routines | an exported routine or array of routines | added as templates |
| `.csv` Strong (old & new export) | Strong → Settings → Export Data | both the comma and the semicolon/"Weight Unit" variants |
| `.csv` Hevy | Hevy → Profile → Settings → Export Data | `weight_kg`/`weight_lbs`, warm‑up/drop/failure set types |
| `.csv` LiftTracker / generic | any CSV with date, exercise, weight, reps columns | set order, RPE and notes picked up when present |

Every import shows a preview (workouts, sets, volume, already‑imported count) before anything
is written. Units are read from the file when it says so; otherwise you pick lbs/kg in the
preview. Duplicates (same start minute + same workout name, or same id) are skipped, so
re‑importing is safe. Cardio/timed rows without reps are skipped. After import, personal
records are recalculated across the whole timeline so PR badges reflect true history.

## Android

See [`android/README.md`](android/README.md) for the Trusted Web Activity wrapper. Short
version: deploy the PWA, set the host in `android/app/src/main/res/values/strings.xml`,
publish `/.well-known/assetlinks.json` with your signing key's SHA‑256, build the APK/AAB.
On a phone you can also simply open the hosted URL in Chrome → **Install app** — same result,
no Play Store needed.

## Keyboard

- `1`–`4` switch tabs; `Esc` closes sheets.
- In a workout: `Enter` in weight → reps → completes the set and jumps to the next one.
