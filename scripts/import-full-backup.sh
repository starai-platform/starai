#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
PACK_FILE="${1:-}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-0}"
RESTORE_ENV_FILE="${RESTORE_ENV_FILE:-0}"

if [ -z "$PACK_FILE" ]; then
  echo "Usage: CONFIRM_RESTORE=1 bash scripts/import-full-backup.sh <starai-full-backup-*.tar.gz>" >&2
  exit 1
fi

if [ ! -f "$PACK_FILE" ]; then
  echo "Backup not found: $PACK_FILE" >&2
  exit 1
fi

if [ "$CONFIRM_RESTORE" != "1" ] && [ "$CONFIRM_RESTORE" != "true" ]; then
  cat >&2 <<'EOF'
Refusing to restore without CONFIRM_RESTORE=1.

This restores a full StarAI backup and can replace local database data.
Use it on a local/dev machine or a new server. Do not run it on production unless restoring from disaster.

Example:
  CONFIRM_RESTORE=1 bash scripts/import-full-backup.sh backups/full/starai-full-backup-xxxx.tar.gz
EOF
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE."
  echo "If you want to restore the env file from the backup first, run:"
  echo "  RESTORE_ENV_FILE=1 CONFIRM_RESTORE=1 bash scripts/import-full-backup.sh $PACK_FILE"
  if [ "$RESTORE_ENV_FILE" != "1" ] && [ "$RESTORE_ENV_FILE" != "true" ]; then
    exit 1
  fi
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if tar -tzf "$PACK_FILE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Backup contains an unsafe archive path." >&2
  exit 1
fi
tar -xzf "$PACK_FILE" -C "$TMP_DIR"

if [ -f "$TMP_DIR/SHA256SUMS" ]; then
  echo "==> Verifying backup checksums"
  (cd "$TMP_DIR" && sha256sum -c SHA256SUMS)
else
  echo "WARNING: This is a legacy backup without SHA256SUMS; integrity cannot be verified." >&2
fi

if [ ! -f "$TMP_DIR/starai-full.dump" ]; then
  echo "starai-full.dump not found in backup." >&2
  exit 1
fi

if [ "$RESTORE_ENV_FILE" = "1" ] || [ "$RESTORE_ENV_FILE" = "true" ]; then
  if [ -f "$TMP_DIR/env.production" ]; then
    if [ -f "$ENV_FILE" ]; then
      cp "$ENV_FILE" "$ENV_FILE.before-full-restore-$(date +%Y%m%d-%H%M%S)"
    fi
    cp "$TMP_DIR/env.production" "$ENV_FILE"
    echo "Restored env file to $ENV_FILE"
  else
    echo "env.production not found in backup." >&2
    exit 1
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE after env restore step." >&2
  exit 1
fi

read_env() {
  local key="$1"
  local value
  value="$(awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); gsub(/\r$/, ""); print; exit }' "$ENV_FILE" || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

DB_USER="$(read_env POSTGRES_USER)"
DB_NAME="$(read_env POSTGRES_DB)"
DB_USER="${DB_USER:-starai}"
DB_NAME="${DB_NAME:-starai}"

echo "==> Checking compose config"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "==> Starting PostgreSQL and Redis"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis

echo "==> Restoring uploads to data/uploads"
rm -rf data/uploads
mkdir -p data
if [ -f "$TMP_DIR/uploads.tar.gz" ]; then
  tar -xzf "$TMP_DIR/uploads.tar.gz" -C data
else
  mkdir -p data/uploads
fi

echo "==> Restoring database: $DB_NAME"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-privileges \
  < "$TMP_DIR/starai-full.dump"

echo "Full backup restore finished."
echo "Next step: bash scripts/deploy-prod.sh"
