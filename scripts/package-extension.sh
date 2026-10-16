#!/usr/bin/env bash
# Builds the Chrome extension for this deployment: the server URL (from
# DOMAIN) and the Google Sheets OAuth client (GOOGLE_SHEETS_CLIENT_ID) are
# filled in, so users only load it and paste the API key.
#
#   ./scripts/package-extension.sh        → build/shortlyst-extension/ (+ .zip)
#
# Builds inside a Node container, so only Docker is needed.
set -euo pipefail
cd "$(dirname "$0")/.."

get_env() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true; }

DOMAIN=$(get_env DOMAIN)
SHEETS_CLIENT_ID=$(get_env GOOGLE_SHEETS_CLIENT_ID)
[ -n "$DOMAIN" ] || { echo "DOMAIN is empty in .env" >&2; exit 1; }
[ -n "$SHEETS_CLIENT_ID" ] || echo "! GOOGLE_SHEETS_CLIENT_ID is empty — Google Sheets import/export won't sign in."

OUT=build/shortlyst-extension
rm -rf "$OUT" && mkdir -p build

docker run --rm \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e NPM_CONFIG_UPDATE_NOTIFIER=false \
  -e SERVER_URL="https://$DOMAIN" -e SHEETS_CLIENT_ID="$SHEETS_CLIENT_ID" \
  -v "$PWD/extension:/src:ro" -v "$PWD/build:/out" \
  node:20-slim bash -euc '
    mkdir /tmp/ext && cd /src && tar --exclude=node_modules --exclude=dist -cf - . | tar -xf - -C /tmp/ext
    cd /tmp/ext
    printf "export const DEFAULT_BACKEND_URL = \"%s\";\n" "$SERVER_URL" > src/lib/config.ts
    node -e "
      const fs = require(\"fs\");
      const m = JSON.parse(fs.readFileSync(\"manifest.json\", \"utf8\"));
      if (process.env.SHEETS_CLIENT_ID) m.oauth2.client_id = process.env.SHEETS_CLIENT_ID;
      fs.writeFileSync(\"manifest.json\", JSON.stringify(m, null, 2) + \"\n\");
    "
    npm ci --no-audit --no-fund --loglevel=error
    npm run build --silent
    rm -rf node_modules
    cp -r /tmp/ext /out/shortlyst-extension
  '

if command -v zip >/dev/null; then
  (cd build && rm -f shortlyst-extension.zip && zip -qr shortlyst-extension.zip shortlyst-extension)
  echo "Built $OUT and build/shortlyst-extension.zip"
else
  echo "Built $OUT"
fi
echo "Install: chrome://extensions → Developer mode → Load unpacked → pick the shortlyst-extension folder."
