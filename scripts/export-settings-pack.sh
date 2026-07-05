#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
OUT_DIR="${OUT_DIR:-backups/settings}"
INCLUDE_ADMIN_ACCOUNTS="${INCLUDE_ADMIN_ACCOUNTS:-0}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Run this script from the deployed project root or set ENV_FILE=..." >&2
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

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d)"
SQL_FILE="$WORK_DIR/settings.sql"
META_FILE="$WORK_DIR/README.txt"
ARCHIVE="$OUT_DIR/starai-settings-$STAMP.tar.gz"

TABLES=(
  system_configs
  models
  model_channel_presets
  role_templates
  workflow_definitions
  home_cards
  gallery_tags
  api_docs
  member_levels
  announcements
)

if [ "$INCLUDE_ADMIN_ACCOUNTS" = "1" ] || [ "$INCLUDE_ADMIN_ACCOUNTS" = "true" ]; then
  TABLES=(admin_roles admin_users "${TABLES[@]}")
fi

TABLE_ARGS=()
for table in "${TABLES[@]}"; do
  TABLE_ARGS+=(--table="public.$table")
done

{
  echo "-- StarAI settings pack"
  echo "-- Created at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "-- Source env: $ENV_FILE"
  echo "--"
  echo "-- This pack contains platform configuration only."
  echo "-- It intentionally excludes users, wallets, orders, tasks, works, assets, withdrawals and logs."
  echo "-- Import only into a clean local/new-server database unless you have a backup."
  echo "BEGIN;"
  echo "TRUNCATE TABLE"
  if [ "$INCLUDE_ADMIN_ACCOUNTS" = "1" ] || [ "$INCLUDE_ADMIN_ACCOUNTS" = "true" ]; then
    echo "  public.admin_operation_logs,"
    echo "  public.admin_users,"
    echo "  public.admin_roles,"
  fi
  echo "  public.api_docs,"
  echo "  public.workflow_definitions,"
  echo "  public.model_channel_presets,"
  echo "  public.role_templates,"
  echo "  public.home_cards,"
  echo "  public.gallery_tags,"
  echo "  public.member_levels,"
  echo "  public.announcements,"
  echo "  public.models,"
  echo "  public.system_configs"
  echo "RESTART IDENTITY CASCADE;"
} > "$SQL_FILE"

echo "==> Exporting settings tables from postgres/$DB_NAME"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --data-only \
    --column-inserts \
    --disable-triggers \
    --no-owner \
    --no-privileges \
    "${TABLE_ARGS[@]}" >> "$SQL_FILE"

echo "COMMIT;" >> "$SQL_FILE"

{
  echo "StarAI settings pack"
  echo
  echo "Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Database: $DB_NAME"
  echo "Included tables:"
  for table in "${TABLES[@]}"; do
    echo "- $table"
  done
  echo
  echo "Excluded by design:"
  echo "- users, auth_identities, wallets, wallet_transactions, cash_transactions"
  echo "- orders, recharge cards, withdrawals, tasks, works, assets, conversations"
  echo "- gallery_items and admin_operation_logs"
  echo
  echo "Security note:"
  echo "- system_configs may contain production keys, storage secrets, SMTP/OAuth settings, and API tokens."
  echo "- Do not commit this archive to GitHub. Store it in a private backup location."
  echo
  echo "Import:"
  echo "  CONFIRM_IMPORT=1 bash scripts/import-settings-pack.sh $ARCHIVE"
} > "$META_FILE"

tar -czf "$ARCHIVE" -C "$WORK_DIR" settings.sql README.txt
rm -rf "$WORK_DIR"

echo "Settings pack created: $ARCHIVE"
echo "Do not commit this archive to GitHub."
