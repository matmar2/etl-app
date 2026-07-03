#!/usr/bin/env bash
# Export the Expo web app and deploy it to the Lightsail box at
# https://etl.avora.aero/app  (static, served by Caddy from /var/www/etl-web).
set -e
cd "$(dirname "$0")"
KEY=/Users/matmar2/Downloads/fly2sky-main-server.pem
HOST=ubuntu@63.184.201.99
PW=SJUxagfHdj11jSiiu5Jx

echo "› exporting web build…"
rm -rf dist
npx expo export --platform web

echo "› syncing to box…"
rsync -az --delete -e "ssh -o StrictHostKeyChecking=no -i $KEY" dist/ "$HOST:~/etl-web/"

echo "› publishing to /var/www/etl-web…"
ssh -o StrictHostKeyChecking=no -i "$KEY" "$HOST" \
  "echo $PW | sudo -S cp -rT /home/ubuntu/etl-web /var/www/etl-web && echo $PW | sudo -S chmod -R a+rX /var/www/etl-web"

echo "✓ deployed → https://etl.avora.aero/app"
