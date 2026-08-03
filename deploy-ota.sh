#!/usr/bin/env bash
# Publish the OTA update(s) with the SAME "Bundle <sha>" stamp as ./deploy-web.sh, so the code
# shown on the iPad (running the OTA) matches the web. BOTH stamp the MONOREPO commit when the
# monorepo's app/ subtree matches the current app code (i.e. ./sync-all-repos.sh has been run).
#
# Run AFTER sync-all-repos.sh + deploy-web.sh:
#   ./sync-all-repos.sh "msg" && ./deploy-web.sh && ./deploy-ota.sh "msg"
#
# Without this (raw `eas update`), the OTA stamps the APP-REPO sha while the web stamps the
# MONOREPO sha → the two never match even though the code is identical.
set -euo pipefail
cd "$(dirname "$0")"

# --- Native-import gate (27 Jul crash-rollback incident) ------------------------------------
# An OTA must NEVER ship JS that loads a native library the installed fleet binaries may lack:
# a static import (or even a try/catch'd require) can abort NATIVELY at boot → the app
# crash-loops and expo-updates rolls back to the embedded bundle. Risky libs may only be loaded
# behind a requireOptionalNativeModule() registry check. Extend RISKY_LIBS when adding a new
# native module; remove an entry only when the MINIMUM installed fleet binary includes it.
RISKY_LIBS="expo-camera expo-notifications expo-speech"
for lib in $RISKY_LIBS; do
  if grep -rnE "^[[:space:]]*import[^;]* from ['\"]$lib" src App.tsx 2>/dev/null; then
    echo "✗ OTA BLOCKED: static import of '$lib' found (native-abort risk on older binaries)."
    echo "  Load it behind requireOptionalNativeModule(...) instead — see BarcodeScanner.tsx."
    exit 1
  fi
done
grep -q "requireOptionalNativeModule('ExpoCamera')" src/components/BarcodeScanner.tsx \
  || { echo "✗ OTA BLOCKED: BarcodeScanner.tsx lost its native-registry guard."; exit 1; }
grep -q "requireOptionalNativeModule('ExpoPushTokenManager')" src/push.ts \
  || { echo "✗ OTA BLOCKED: push.ts lost its native-registry guard."; exit 1; }
grep -q "requireOptionalNativeModule('ExpoSpeech')" src/util/speech.ts \
  || { echo "✗ OTA BLOCKED: speech.ts lost its native-registry guard."; exit 1; }
echo "✓ native-import gate passed (risky libs registry-gated)"

# Same rule as deploy-web.sh: use the monorepo HEAD sha iff its app/ subtree == our app tree.
MONO="../.avora-mono"
if [ "$(git rev-parse HEAD^{tree} 2>/dev/null)" = "$(git -C "$MONO" rev-parse HEAD:app 2>/dev/null)" ]; then
  export EAS_BUILD_GIT_COMMIT_HASH="$(git -C "$MONO" rev-parse HEAD)"
  echo "› bundle code = monorepo $(printf %.7s "$EAS_BUILD_GIT_COMMIT_HASH") (matches web + the iPad build)"
else
  echo "⚠ monorepo not in sync with current app code — run ./sync-all-repos.sh first; using app-repo sha."
fi

MSG="${1:-OTA update}"
for CH in production adhoc; do
  echo "› eas update --channel $CH …"
  npx eas update --channel "$CH" --platform ios --message "$MSG" --non-interactive | grep -E "Branch|Message|Commit|Runtime" || true
done
echo "✓ OTA published to production + adhoc — stamp matches ./deploy-web.sh"

# --- Release governance: auto-approve the deployed revision -----------------------------------
# The iPad only surfaces/runs the revision approved in ETL governance. Publishing a version IS
# approving it — UNLESS the dual-CAMO gate is switched on (go-live), where auto_publish leaves it
# 'published' pending both CAMO signatures. Best-effort: never fails the OTA if the box is offline.
VER="$(node -p "require('./app.json').expo.version" 2>/dev/null || true)"
if [ -n "$VER" ]; then
  ssh aws-camo "docker exec backend-api-1 python -c \"
from app.database import SessionLocal
from app.routers.releases import auto_publish
db=SessionLocal()
for ch in ('production','adhoc'):
    r=auto_publish(db, ch, '$VER', '$VER', 'auto: deploy-ota.sh')
    print('  release', ch, r['revision'], '->', r['status'], '| auto_approved', r['auto_approved'], '| dual', r['dual_approval'])
\"" 2>/dev/null && echo "✓ release $VER approved in governance (or held for CAMO if dual-gate on)" \
    || echo "⚠ release governance not reached — approve $VER in Back office → App Build & Release"
fi
