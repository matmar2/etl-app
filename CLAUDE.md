# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`etl-app` — the iPad **Electronic Tech Log** (Expo / React Native + TypeScript) for Fly2Sky, replacing the paper
Aircraft Technical Log under EASA Part-M **M.A.306** / Part-CAMO. Offline-first: every entry can be made, signed
and printed with no connectivity, then syncs to the FastAPI backend.

Ships three ways from one codebase: **iPad native build** (TestFlight / ad-hoc, EAS), **OTA JS updates** to those
iPads, and a **web build** at `https://etl.avora.aero/app` (react-native-web).

### Repo topology

This repo is `app/` inside the working folder `~/Documents/ETLApplication`, which also holds sibling repos:

| Path | Repo | What |
|---|---|---|
| `app/` (here) | `matmar2/etl-app` | this Expo app |
| `../backend/` | `matmar2/etl-backend` | FastAPI + Postgres API, `app/qa.py` QA sweep, `update_docs.py` User Guide |
| `../backoffice/` | `matmar2/etl-backoffice` | Next.js admin web |
| `../.avora-mono` | `Avora-Group/ETL-Application` | monorepo mirror rebuilt from the three subtrees; **its** commit is the "Bundle `<sha>`" stamp |

`../sync-all-repos.sh "msg"` commits + pushes all four. `../HOW-TO-MAKE-A-CHANGE.md` is the operator-facing
version of the workflow below.

## Commands

```bash
npx tsc --noEmit           # the only static check — see "known error" below
npx expo start             # dev server; i = iOS simulator
npx expo export --platform web --clear    # what deploy-web.sh runs

# deploy — run in THIS order so web and OTA carry the same bundle stamp
../sync-all-repos.sh "what changed" && ./deploy-web.sh && ./deploy-ota.sh "what changed"

npx eas build --profile adhoc --platform ios          # native build, registered iPads
npx eas build --profile f2stestflight --platform ios --auto-submit
npx eas device:create / device:list                   # ad-hoc UDID registration (ADHOC_DISTRIBUTION.md)
```

`eas` is not on PATH — always `npx eas`. Non-terminal users trigger builds/OTA from the back office
(Admin → App Build & Release), which dispatches `.github/workflows/app-build.yml`.

**Known `tsc` error:** exactly one — `App.tsx(179) TS2769` (`Stack.Navigator` missing `id` in
`@react-navigation` v7 types). Anything else is a real error; fix it before deploying.

**There is no unit-test suite.** The test harness is **Back office → QA → ▶ Run full QA sweep**
(`../backend/app/qa.py`), expected to report **0 failed**. Three standing warnings (HIL due dates, MFA
enrolment, unsynced test iPads) are known test-data noise.

### QA bundle markers — required for user-visible app changes

`qa.py::_web_bundle_current` fetches the live web bundle and asserts each string in `_BUNDLE_MARKERS`
is present, which is the only check that catches a stale/rolled-back client deploy. When shipping a
user-visible feature, add a string that exists **only** in the new code (a dialog title, a fallback
message) to `_BUNDLE_MARKERS` in `../backend/app/qa.py`. Rewording such a string in the app without
updating `qa.py` breaks the sweep.

## Architecture

### Offline-first data flow

The client owns UUIDs and writes locally first; the server is source of truth only after signing.

- `src/db/schema.ts` — SQLite (`etl.db`) mirror: `sectors`, `defects`, `attachments`, `checks`,
  `flight_cache`, `ref_cache`, `outbox`. `dirty = 1` marks a row pending sync.
- `src/db/outbox.ts` — generic replay queue for mutations made offline. Replayed oldest-first;
  dropped only on a terminal 4xx, retained on offline/5xx.
- `src/api/client.ts` (~1700 lines, the app's hub) — every endpoint wrapper plus the sync machinery:
  - `api()` throws `NetworkError` when the request never reached the server (callers fall back to local),
    and a `Error("<METHOD> <path> → <status>: detail")` otherwise.
  - `mutateOrQueue()` — fire-and-forget mutations: online normally, else queued, returns `{queued:true}`.
  - `syncPush()` — flush attachments, checks, password resets, outbox, then push dirty sectors/defects to
    `/sync/push`. A `missing_required*` outcome keeps the row dirty rather than losing it. Driven from
    `App.tsx` every 30 s and on foreground.
  - `cachedList` / `cachedJson` / `cachedHtml` — server result cached to SecureStore + `ref_cache` so
    lists, TL/HIL HTML and previews survive offline; `prefetch*` warms them before a flight.
- `src/db/sectors.ts` keeps **tombstones** so an offline-deleted sector is never re-inserted by a server pull.

### Roles and permissions

`loadPermissions()` fetches an admin-configurable `AccessMap` (`pages` + `page.field` → `rw`/`ro`).
Screens gate on `can('departure', 'fuel')` / `access(...)`; both **fail closed** (read-only) until the map
loads, and the cached map is only reused for the same role. The backend enforces regardless. Coarser
role checks use `role()` (`captain` | `pilot` | `mechanic` | `cabin` | `camo` | `admin`);
`roleLabel()` renders `pilot` as "First Officer".

### App shell (`App.tsx`)

A native-stack navigator plus five always-on concerns: idle auto sign-out (server-configured minutes,
also applied to background time), the global `ErrorUtils` handler reporting fatals to
`reportDeviceError()`, the 30 s `syncPush` flush, a 45 s `heartbeat()` that drives master-iPad failover
and master-initiated "sync now", and a serviceability poll that tints every header green/red from a
single source of truth (`onAircraftStatus`). Overlays mounted outside the navigator: `SyncBlockHost`,
`AckOverlay`, `BroadcastGate`, `InductionGate`.

### Onboard peer sync (`src/p2p/`)

`engine.ts` is pure-JS reconcile (works everywhere); the transport is the local Expo module
`modules/peer-sync` (iOS MultipeerConnectivity, Bluetooth/Wi-Fi), reached through
`requireNativeModule('PeerSync')` in `native.ts` and inert when absent. `plugins/withPeerSync.js` injects
the Local Network usage string + Bonjour service (must match `serviceType` in `PeerSyncModule.swift`).
**It is deliberately not started at boot** — a native start fault would crash-loop before an OTA fix could
download. It starts on demand from Master iPad → "Sync all iPads".

### Platform splits

`*.web.ts(x)` siblings are picked by Metro on web: `db/schema.web.ts`, `db/sectors.web.ts`,
`db/defects.web.ts` (SQLite stubs — web talks to the server directly), `SignaturePad`, `MapCanvas`,
`AmmInstruction`. Anything with a `Platform.OS === 'web'` branch (printing, alerts, `window.open`) needs
checking on both. In `src/print/`, web opens a real window (Safari blocks `window.open` after an `await` —
use `beginPrint()` at tap time, then `finishPrint()`), the iPad uses `expo-print`; server-rendered PDFs are
preferred for exact pagination with an HTML fallback when offline.

### UI

`src/theme.ts` (dark navy tokens) + `src/ui.ts` (shared `StyleSheet`: `screen`, `section`, `card`, `input`,
`btn*`, `pill`). Use these rather than re-rolling inline styles. Landscape-only, iPad-first.
`SignatureBlock` renders captured signatures on a white card (dark ink is invisible on the theme).

## Conventions and invariants

**Compliance (do not break):**
1. No overwrites — corrections are new entries; signed records are immutable.
2. Server is source of truth after signing; the client is authoritative only for `dirty = 1` drafts.
3. Sector entry, signing and the PDF fallback must fully work offline.
4. Every record carries `created_by` / `signed_by` / `device_id` / UTC / `version`.

**Native modules — the OTA crash rule.** A JS bundle shipped OTA must never statically import a native
library that installed fleet binaries may lack: the import can abort *natively* (uncatchable by
try/catch), crash-looping the app until `expo-updates` rolls back (the 26–27 Jul 2026 incidents). Load
such libraries only behind `requireOptionalNativeModule('ExpoCamera')` / `('ExpoPushTokenManager')` —
see `src/components/BarcodeScanner.tsx` and `src/push.ts`. `deploy-ota.sh` enforces this with a
pre-publish gate over `RISKY_LIBS` (`expo-camera`, `expo-notifications`); add each new native module to
that list and remove it only once the minimum installed binary contains it.

**Bundle stamping.** `app.config.js` stamps `extra.commit` (shown as "Bundle `<sha>`" on the Main Menu).
Both deploy scripts export `EAS_BUILD_GIT_COMMIT_HASH` from the monorepo HEAD *only* when its `app/`
subtree matches this tree — hence sync first, or the iPad and web stamps diverge. `deploy-web.sh` aborts
if the exported bundle doesn't contain the expected sha (stale Metro cache).

**Missing-field feedback.** Sign-off screens auto-scroll to the first gap, which can push the inline
"Complete before signing: …" message out of view — so also raise the list via `notifyAction()`
(`src/util/confirm.ts`); `confirmAction()` is the cross-platform yes/no.

**Other:**
- TL page numbers are a per-tail integer sequence formatted `NNN-NNN` — always via `fmtTl`/`parseTl` (`src/util/tl.ts`).
- Post-signature "aircraft serviceable" progress uses `finalizeServiceable()` (`src/util/finalize.ts`), which is offline-aware.
- Numeric inputs go through `numericOnly()`; hours/times through `hm`/`hhmm`/`fmtHM` in `src/screens/sectorShared.tsx`.
- One screen per file in `src/screens/`; shared API/logic belongs in `src/api/client.ts`, not in screens.
- ICAO/EASA terms throughout (FDP, CRS, HIL, MEL/CDL, DI, PFI, ATA, TSN/CSN, OOOI).
- Comments explain *why* — regulatory reason, incident, or platform quirk. The existing dense comment
  blocks are load-bearing context; keep that style and don't strip them.
- After any non-trivial change: verify in the app, run the QA sweep, then `../sync-all-repos.sh "msg"`.
