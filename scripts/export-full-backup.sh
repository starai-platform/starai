#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
OUT_DIR="${OUT_DIR:-backups/full}"

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
LOCAL_STORAGE_DIR_VALUE="$(read_env LOCAL_STORAGE_DIR)"
DB_USER="${DB_USER:-starai}"
DB_NAME="${DB_NAME:-starai}"
CONTAINER_UPLOAD_DIR="${LOCAL_STORAGE_DIR_VALUE:-/app/data/uploads}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d)"
ARCHIVE="$OUT_DIR/starai-full-backup-$STAMP.tar.gz"
DB_DUMP="$WORK_DIR/starai-full.dump"
UPLOADS_TGZ="$WORK_DIR/uploads.tar.gz"
META_FILE="$WORK_DIR/README.txt"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "==> Checking compose config"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "==> Exporting database: $DB_NAME"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner --no-privileges \
  > "$DB_DUMP"

if [ -d "data/uploads" ]; then
  echo "==> Packing host uploads: data/uploads"
  tar -czf "$UPLOADS_TGZ" -C data uploads
else
  API_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q api || true)"
  DETECTED_UPLOAD_DIR=""
  if [ -n "$API_CONTAINER" ]; then
    DETECTED_UPLOAD_DIR="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api sh -lc "
      for d in '$CONTAINER_UPLOAD_DIR' /app/data/uploads /data/uploads /uploads; do
        if [ -d \"\$d\" ]; then
          echo \"\$d\"
          exit 0
        fi
      done
      exit 0
    " | tr -d '\r' | head -n 1)"
  fi
  if [ -n "$DETECTED_UPLOAD_DIR" ]; then
    echo "==> Packing API container uploads: $DETECTED_UPLOAD_DIR"
    mkdir -p "$WORK_DIR/uploads"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
      sh -lc "tar -C '$DETECTED_UPLOAD_DIR' -czf - ." \
      > "$WORK_DIR/uploads-content.tar.gz"
    tar -xzf "$WORK_DIR/uploads-content.tar.gz" -C "$WORK_DIR/uploads"
    tar -czf "$UPLOADS_TGZ" -C "$WORK_DIR" uploads
  else
    echo "==> No uploads directory found. Creating an empty uploads archive."
    mkdir -p "$WORK_DIR/uploads"
    printf 'No uploads directory was found during backup.\n' > "$WORK_DIR/uploads/README.txt"
    tar -czf "$UPLOADS_TGZ" -C "$WORK_DIR" uploads
  fi
fi

cp "$ENV_FILE" "$WORK_DIR/env.production"

{
  echo "StarAI full backup"
  echo
  echo "Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Database: $DB_NAME"
  echo "Database dump: starai-full.dump"
  echo "Uploads archive: uploads.tar.gz"
  echo "Env file copy: env.production"
  echo
  echo "Security note:"
  echo "- This archive contains the full database and production env file."
  echo "- It may include users, wallets, orders, API keys, admin accounts, upstream tokens, SMTP/OAuth secrets."
  echo "- Do not commit it to GitHub."
} > "$META_FILE"

tar -czf "$ARCHIVE" -C "$WORK_DIR" starai-full.dump uploads.tar.gz env.production README.txt

echo "Full backup created: $ARCHIVE"
echo "Do not commit this archive to GitHub."
