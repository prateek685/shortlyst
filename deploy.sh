#!/usr/bin/env bash
# Deploys (or updates) Shortlyst on this server.
#
#   cp .env.production.example .env   # fill in DOMAIN and OPENROUTER_API_KEY (+ Gmail, Sheets)
#   ./deploy.sh
#
# Safe to run again: it only generates secrets that are still empty, and an
# update is just `git pull && ./deploy.sh`.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env
COMPOSE=(docker compose -f docker-compose.prod.yml)

say()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!   %s\033[0m\n' "$*"; }
fail() { printf '\033[31mx   %s\033[0m\n' "$*" >&2; exit 1; }

get_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
set_env() {
  local tmp
  tmp=$(mktemp)
  if grep -qE "^$1=" "$ENV_FILE"; then
    awk -v k="$1" -v v="$2" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    printf '%s=%s\n' "$1" "$2" >>"$tmp"
  fi
  cat "$tmp" >"$ENV_FILE" && rm -f "$tmp"
}
# Sets KEY only when it is still empty — never replaces an existing secret.
generate() { [ -n "$(get_env "$1")" ] || set_env "$1" "$2"; }

# --- 1. checks ---------------------------------------------------------------
command -v docker >/dev/null || fail "Docker is not installed (https://docs.docker.com/engine/install/)."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing (the 'docker compose' command)."
command -v openssl >/dev/null || fail "openssl is not installed."
[ -f "$ENV_FILE" ] || fail "No .env yet. Run: cp .env.production.example .env  and fill it in."

DOMAIN=$(get_env DOMAIN)
[ -n "$DOMAIN" ] || fail "DOMAIN is empty in .env (e.g. shortlyst.example.com)."
[ -n "$(get_env OPENROUTER_API_KEY)" ] || fail "OPENROUTER_API_KEY is empty in .env."
case "$DOMAIN" in http*://*) fail "DOMAIN must be just the name, without http(s)://";; esac
[ -n "$(get_env GMAIL_CLIENT_ID)" ] && [ -n "$(get_env GMAIL_CLIENT_SECRET)" ] \
  || warn "GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET empty — the email feature stays off."

# --- 2. secrets (first run only) ---------------------------------------------
say "Generating missing secrets in .env"
generate SHORTLYST_API_KEY "$(openssl rand -hex 24)"
generate MAIL_CREDENTIALS_KEY "$(openssl rand -base64 32)"
generate POSTGRES_PASSWORD "$(openssl rand -hex 24)"

PROFILES=()
LANGFUSE_DOMAIN=$(get_env LANGFUSE_DOMAIN)
if [ "$(get_env ENABLE_LANGFUSE)" = "true" ]; then
  [ -n "$LANGFUSE_DOMAIN" ] || fail "ENABLE_LANGFUSE=true needs LANGFUSE_DOMAIN (e.g. langfuse.$DOMAIN)."
  [ -n "$(get_env LANGFUSE_ADMIN_EMAIL)" ] || fail "ENABLE_LANGFUSE=true needs LANGFUSE_ADMIN_EMAIL (your login)."
  generate LANGFUSE_PUBLIC_KEY "pk-lf-$(openssl rand -hex 16)"
  generate LANGFUSE_SECRET_KEY "sk-lf-$(openssl rand -hex 16)"
  generate LANGFUSE_ADMIN_PASSWORD "$(openssl rand -hex 12)"
  generate LANGFUSE_DB_PASSWORD "$(openssl rand -hex 24)"
  generate LANGFUSE_NEXTAUTH_SECRET "$(openssl rand -hex 32)"
  generate LANGFUSE_SALT "$(openssl rand -hex 32)"
  generate LANGFUSE_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env LANGFUSE_HOST "http://langfuse:3000"
  PROFILES=(--profile langfuse)
fi
chmod 600 "$ENV_FILE"

# --- 3. HTTPS config ---------------------------------------------------------
mkdir -p deploy
{
  printf '%s {\n\treverse_proxy app:3000\n}\n' "$DOMAIN"
  [ ${#PROFILES[@]} -eq 0 ] || printf '\n%s {\n\treverse_proxy langfuse:3000\n}\n' "$LANGFUSE_DOMAIN"
} >deploy/Caddyfile

# --- 4. build and start ------------------------------------------------------
say "Building and starting containers (first run takes a few minutes)"
"${COMPOSE[@]}" "${PROFILES[@]}" up -d --build --remove-orphans

say "Waiting for the backend to report healthy"
healthy=false
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app node -e \
    "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    healthy=true
    break
  fi
  sleep 3
done
if [ "$healthy" != true ]; then
  "${COMPOSE[@]}" logs --tail 40 app
  fail "Backend did not become healthy — see the logs above."
fi

# --- 5. summary --------------------------------------------------------------
say "Shortlyst is running"
cat <<EOF

  Server URL        https://$DOMAIN
  API key           $(get_env SHORTLYST_API_KEY)
  Gmail redirect    https://$DOMAIN/mail/oauth/gmail/callback   (add to the Gmail OAuth client)
EOF
if [ ${#PROFILES[@]} -gt 0 ]; then
  cat <<EOF
  Langfuse          https://$LANGFUSE_DOMAIN
                    login $(get_env LANGFUSE_ADMIN_EMAIL) / $(get_env LANGFUSE_ADMIN_PASSWORD)
EOF
fi
cat <<EOF

  Next: build the Chrome extension for this server with
        ./scripts/package-extension.sh
  Logs: docker compose -f docker-compose.prod.yml logs -f app

EOF
