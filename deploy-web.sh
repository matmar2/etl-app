#!/usr/bin/env bash
# Export the Expo web app and deploy it to the prod box at
# https://etl.avora.aero/app  (static, served by Caddy from /var/www/etl-web).
#
# Targets the CURRENT prod box (3.65.121.137, Tailscale 100.73.102.107) over the
# deploy key. The old box (63.184.201.99) is frozen/compromised — do NOT deploy there.
#
#   ./deploy-web.sh
#
# Override if needed:  DEPLOY_KEY=~/.ssh/other  DEPLOY_HOST=ubuntu@1.2.3.4 ./deploy-web.sh
set -euo pipefail
cd "$(dirname "$0")"

KEY="${DEPLOY_KEY:-$HOME/.ssh/etl_box_deploy}"
HOST="${DEPLOY_HOST:-ubuntu@100.73.102.107}"
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

echo "› exporting web build…"
rm -rf dist
npx expo export --platform web

echo "› syncing to box ($HOST)…"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" dist/ "$HOST:/home/ubuntu/etl-web/"

echo "› publishing to /var/www/etl-web…"
ssh "${SSH_OPTS[@]}" "$HOST" \
  'sudo cp -rT /home/ubuntu/etl-web /var/www/etl-web && sudo chmod -R a+rX /var/www/etl-web'

echo "✓ deployed → https://etl.avora.aero/app"
