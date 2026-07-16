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
