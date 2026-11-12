#!/usr/bin/env bash
# Deploys staging to the shared Hetzner server. Images come from GHCR (built by
# .github/workflows/images.yml); nothing is built on the server.
#   infra/staging/deploy.sh <user@host> [ssh-key] [image-tag]
#   e.g. infra/staging/deploy.sh root@49.13.167.124 ~/.ssh/projectflow_deploy
# image-tag defaults to the current commit, which must already be pushed and built.
# First run creates /opt/fleet/.env with fresh secrets; they stay only on the server.
set -euo pipefail

TARGET=${1:?usage: deploy.sh <user@host> [ssh-key] [image-tag]}
KEY=${2:-}
cd "$(git rev-parse --show-toplevel)"
TAG=${3:-$(git rev-parse HEAD)}
SITE_HOST=${SITE_HOST:-fleet.projectflow.site}
IMAGE_PREFIX=ghcr.io/motaha-2020/fleet-management-system
SSH=(ssh -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes ${KEY:+-i "$KEY"} "$TARGET")

echo "==> uploading deployment files"
tar -czf - -C infra/staging docker-compose.yml fleet.caddy \
  | "${SSH[@]}" 'mkdir -p /opt/fleet /srv/fleet && tar -xzf - -C /opt/fleet'

"${SSH[@]}" TAG="$TAG" SITE_HOST="$SITE_HOST" IMAGE_PREFIX="$IMAGE_PREFIX" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/fleet
ENV=/opt/fleet/.env
if [ ! -f "$ENV" ]; then
  (umask 077; printf 'SITE_HOST=%s\nIMAGE_PREFIX=%s\nPOSTGRES_PASSWORD=%s\n' "$SITE_HOST" "$IMAGE_PREFIX" "$(openssl rand -hex 24)" > "$ENV")
fi
chmod 600 "$ENV"
sed -i '/^IMAGE_TAG=/d' "$ENV" && echo "IMAGE_TAG=$TAG" >> "$ENV"
C=(docker compose --env-file "$ENV" -f docker-compose.yml)

echo "==> pulling images ($TAG)"
"${C[@]}" pull --quiet

if ! grep -q '^MASTER_KEY=' "$ENV"; then
  echo "==> generating MASTER_KEY and JWT signing key"
  docker run --rm --entrypoint node "$IMAGE_PREFIX/api:$TAG" dist/cli/gen-env.js >> "$ENV"
fi

echo "==> starting"
"${C[@]}" up -d --remove-orphans
"${C[@]}" ps

echo "==> Caddy site"
CF=/etc/caddy/Caddyfile
cp "$CF" "$CF.bak.fleet.$(date +%F-%H%M%S)"
OLD_SNIPPET=$(cat /srv/fleet/fleet.caddy 2>/dev/null || true)
install -m 644 fleet.caddy /srv/fleet/fleet.caddy && chmod 755 /srv/fleet   # Caddy runs as its own user
grep -q '^import /srv/fleet/fleet.caddy' "$CF" || printf '\n# Fleet staging (added by fleet infra/staging/deploy.sh)\nimport /srv/fleet/fleet.caddy\n' >> "$CF"
if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy; then
  echo "Caddy reloaded"
else
  echo "Caddy config invalid, rolling back" >&2
  cp "$(ls -t $CF.bak.fleet.* | head -1)" "$CF"
  if [ -n "$OLD_SNIPPET" ]; then printf '%s\n' "$OLD_SNIPPET" > /srv/fleet/fleet.caddy; else rm -f /srv/fleet/fleet.caddy; fi
  exit 1
fi
echo "==> https://$SITE_HOST"
REMOTE
