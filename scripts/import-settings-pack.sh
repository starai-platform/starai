#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
PACK_FILE="${1:-}"
CONFIRM_IMPORT="${CONFIRM_IMPORT:-0}"
BACKUP_BEFORE_IMPORT="${BACKUP_BEFORE_IMPORT:-1}"

if [ -z "$PACK_FILE" ]; then
  echo "Usage: CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh <settings.sql|starai-settings-*.tar.gz>" >&2
  exit 1
fi

if [ ! -f "$PACK_FILE" ]; then
  echo "Settings pack not found: $PACK_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.example and fill target values first." >&2
  exit 1
fi

if [ "$CONFIRM_IMPORT" != "1" ] && [ "$CONFIRM_IMPORT" != "true" ]; then
  cat >&2 <<'EOF'
Refusing to import without CONFIRM_IMPORT=1.

This import replaces platform configuration tables in the target database.
Use it for a clean local database or a new server after migrations have run.
Do not run it on a live production database unless you have a fresh backup.

Example:
  CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh backups/settings/starai-settings-xxxx.tar.gz
EOF
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

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

SQL_FILE="$PACK_FILE"
case "$PACK_FILE" in
  *.tar.gz|*.tgz)
    tar -xzf "$PACK_FILE" -C "$TMP_DIR"
    SQL_FILE="$TMP_DIR/settings.sql"
    ;;
esac

if [ ! -f "$SQL_FILE" ]; then
  echo "settings.sql not found in pack: $PACK_FILE" >&2
  exit 1
fi

echo "==> Checking compose config"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "==> Starting PostgreSQL"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres

if [ "$BACKUP_BEFORE_IMPORT" = "1" ] || [ "$BACKUP_BEFORE_IMPORT" = "true" ]; then
  mkdir -p backups/settings
  BACKUP_FILE="backups/settings/before-settings-import-$(date +%Y%m%d-%H%M%S).sql"
  echo "==> Backing up current settings tables to $BACKUP_FILE"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$DB_USER" -d "$DB_NAME" \
      --data-only \
      --column-inserts \
      --no-owner \
      --no-privileges \
      --table=public.system_configs \
      --table=public.models \
      --table=public.model_channel_presets \
      --table=public.role_templates \
      --table=public.workflow_definitions \
      --table=public.home_cards \
      --table=public.gallery_tags \
      --table=public.api_docs \
      --table=public.member_levels \
      --table=public.announcements \
      > "$BACKUP_FILE" || true
fi

echo "==> Importing settings pack into postgres/$DB_NAME"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$SQL_FILE"

echo "Settings import finished."
echo "If web/admin are already running, refresh the browser. No service restart is required for database-only settings."
