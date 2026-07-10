# Fly2Sky ETL — Ad-Hoc Distribution (no App Store, no review)

Install the ETL app straight onto specific iPads by registering each device's UDID.
No Apple review, no App Store listing, no team membership. Trade-off: every iPad must be
registered once, and you rebuild when you add a new device.

**Run everything from:** `~/Documents/ETLApplication/app`
**`eas` is not on PATH — always use `npx eas`.**

Reference for this app:
- Apple Team: `FLY2SKY EAD (B3F45CXANN)`
- Bundle ID: `aero.avora.fly2sky.etl`
- EAS build profile: `adhoc` (in `eas.json`) · OTA channel: `adhoc`
- Device cap: **100 iPads per year**; cert/profile expire ~yearly (one rebuild to renew).

---

## Phase A — Register each iPad (ONE TIME per device)

Do this once per iPad. The **same link works for all devices**.

### A1. Create / show the registration link
```bash
cd ~/Documents/ETLApplication/app
npx eas device:create
```
- Logs in to your Apple account, then asks how to register → choose **Website**.
- Prints a **registration URL + QR code**, e.g.
  `https://expo.dev/register-device/<id>`.
- *What it does:* generates one reusable link that captures an iPad's UDID into your
  Apple Developer account.

### A2. Each iPad opens the link
On **every** crew iPad:
1. Open the link in **Safari** (not Chrome).
2. Tap **Allow** to download the profile — nothing else appears on screen.
3. Go to **Settings** → tap **Profile Downloaded** (near the top) → **Install** →
   enter passcode → **Install**.
- *What it does:* records that iPad's UDID under your account so a build can include it.
- This installs no app — it only registers the device.

### A3. Confirm the devices arrived
```bash
npx eas device:list
```
- *What it does:* lists every registered iPad (UDID + model). Re-run until all the iPads
  you want are shown. "Name: Unknown" is normal — the UDID is what matters.

> **Register ALL target iPads before building** — a build only includes devices that are
> registered at the moment it runs.

---

## Phase B — Build the ad-hoc app (ONE build covers all registered iPads)

### B1. Start the build
```bash
cd ~/Documents/ETLApplication/app
npx eas build --profile adhoc --platform ios
```
- Logs in to Apple, prepares the ad-hoc provisioning profile, then asks:
  **"All your registered devices are present… reuse the profile?"** → choose **Yes**.
- Uploads the project and builds in the EAS cloud (~10–20 min). Prints a build page link.
- *What it does:* produces a signed `.ipa` locked to the UDIDs registered so far.

### B2. Wait for it to finish
- Leave the terminal open (or reopen the printed **build page URL** on
  `expo.dev/accounts/mathewos/projects/etl-app/builds`).
- When done it prints an **install URL + QR** for the app itself.

---

## Phase C — Install on the iPads

On each **registered** iPad:
1. Open the **build's install link** (from B2) in Safari → **Install**.
   - *What it does:* installs the actual ETL app onto the home screen.
2. First launch only: **Settings → General → VPN & Device Management → trust** the
   Fly2Sky developer profile.
3. Open the app → sign in with the ETL account (testing period MFA code `123456`).

Devices **not** in this build will refuse to install — that's the ad-hoc lock working.

---

## Phase D — Push updates WITHOUT rebuilding

For JavaScript / content changes (most updates), no new build or reinstall:
```bash
cd ~/Documents/ETLApplication/app
npx eas update --channel adhoc --platform ios -m "what changed"
```
- *What it does:* publishes an over-the-air update to the `adhoc` channel; every ad-hoc
  iPad picks it up on next launch. (Same mechanism TestFlight uses on its channel.)
- You only go back to **Phase B (rebuild)** for **native** changes or to **add a new iPad**.

---

## Adding a NEW iPad later
1. Send that person the **same registration link** from A1 (reuse it).
2. They do **A2** on their iPad; confirm with **A3** (`npx eas device:list`).
3. **Rebuild** — repeat **Phase B** (`npx eas build --profile adhoc --platform ios`,
   answer **Yes**). The new build now includes them.
4. They install from the **new** build link (Phase C).

Existing iPads are unaffected and keep getting OTA updates.

---

## Quick reference — the whole loop
```bash
cd ~/Documents/ETLApplication/app

# 1. one-time per iPad: register UDIDs (share the printed link)
npx eas device:create
npx eas device:list          # confirm all iPads present

# 2. one build for everyone registered
npx eas build --profile adhoc --platform ios   # answer: Yes (reuse profile)

# 3. share the build's install link → each iPad installs & signs in

# 4. future changes, no rebuild:
npx eas update --channel adhoc --platform ios -m "message"
```

---

## Troubleshooting
- **"Nothing appears on the iPad after the link"** — registration installs no app; check
  **Settings → Profile Downloaded** to finish A2. The app only appears after Phase C.
- **App won't install on an iPad** — that iPad wasn't registered before the build. Register
  it (Phase A) and rebuild (Phase B).
- **"Untrusted Developer" on first launch** — Settings → General → VPN & Device Management →
  trust the Fly2Sky profile (Phase C step 2).
- **Update didn't show** — `eas update` needs one online launch; fully close and reopen the
  app. Native changes need a rebuild, not an update.
- **Ran out of device slots / cert expired (~yearly)** — renew via a fresh
  `npx eas build --profile adhoc` after `eas device:list` is current.

---

## When to leave ad-hoc behind
Ad-hoc is the quick, no-review stopgap. For the full fleet at go-live, **Apple Business
Manager + MDM** removes the per-device registration and per-device rebuilds entirely — you
enrol the iPads once and push the app centrally. Your org is already ABM-verified.
