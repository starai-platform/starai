#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
BUILD_SERVICES="${BUILD_SERVICES:-api worker web admin}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-auto}"
STOP_SERVICES_BEFORE_BUILD="${STOP_SERVICES_BEFORE_BUILD:-1}"
NO_CACHE_SERVICES="${NO_CACHE_SERVICES:-}"
IMPORT_SETTINGS_PACK="${IMPORT_SETTINGS_PACK:-0}"
SETTINGS_PACK="${SETTINGS_PACK:-}"
PRUNE_BUILD_CACHE="${PRUNE_BUILD_CACHE:-1}"
BUILD_CACHE_KEEP_STORAGE="${BUILD_CACHE_KEEP_STORAGE:-4GB}"

# 4C8G VPS can be killed by parallel Docker/Next/Go builds. Keep deploys
# predictable by default; override these env vars only on larger machines.
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.example and fill production values first." >&2
  exit 1
fi

echo "==> Checking compose config"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "==> Starting PostgreSQL and Redis"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis

if [ "$STOP_SERVICES_BEFORE_BUILD" = "1" ] || [ "$STOP_SERVICES_BEFORE_BUILD" = "true" ]; then
  echo "==> Stopping target services before build to free memory: $BUILD_SERVICES"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop $BUILD_SERVICES || true
fi

echo "==> Building service images sequentially: $BUILD_SERVICES"
for service in $BUILD_SERVICES; do
  echo "==> Building $service"
  no_cache_flag=""
  for no_cache_service in $NO_CACHE_SERVICES; do
    if [ "$no_cache_service" = "$service" ]; then
      no_cache_flag="--no-cache"
      break
    fi
  done
  if [ -n "$no_cache_flag" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build "$no_cache_flag" "$service"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build "$service"
  fi
done

should_run_migrations=false
if [ "$RUN_MIGRATIONS" = "1" ] || [ "$RUN_MIGRATIONS" = "true" ]; then
  should_run_migrations=true
elif [ "$RUN_MIGRATIONS" = "auto" ]; then
  for service in $BUILD_SERVICES; do
    if [ "$service" = "api" ]; then
      should_run_migrations=true
      break
    fi
  done
fi

if [ "$should_run_migrations" = "true" ]; then
  echo "==> Running database migrations"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile tools run --rm migrate
else
  echo "==> Skipping database migrations"
fi

if [ "$IMPORT_SETTINGS_PACK" = "1" ] || [ "$IMPORT_SETTINGS_PACK" = "true" ]; then
  if [ -z "$SETTINGS_PACK" ]; then
    echo "IMPORT_SETTINGS_PACK is enabled but SETTINGS_PACK is empty." >&2
    echo "Example: IMPORT_SETTINGS_PACK=1 SETTINGS_PACK=backups/settings/starai-settings-xxxx.tar.gz bash scripts/deploy-prod.sh" >&2
    exit 1
  fi
  echo "==> Importing settings pack: $SETTINGS_PACK"
  CONFIRM_IMPORT=1 BACKUP_BEFORE_IMPORT=0 ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" \
    bash scripts/import-settings-pack.sh "$SETTINGS_PACK"
else
  echo "==> Skipping settings pack import"
fi

echo "==> Starting application services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate $BUILD_SERVICES

echo "==> Current status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "==> Frontend build fingerprints"
for service in $BUILD_SERVICES; do
  if [ "$service" = "web" ] || [ "$service" = "admin" ]; then
    container_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service" || true)"
    if [ -n "$container_id" ]; then
      build_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$service" sh -lc 'cat /app/apps/'"$service"'/.next/BUILD_ID 2>/dev/null || true')"
      image_id="$(docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null || true)"
      echo "  $service container=$container_id image=$image_id build_id=${build_id:-unknown}"
    fi
  fi
done

echo "==> Pruning dangling images"
docker image prune -f >/dev/null || true

if [ "$PRUNE_BUILD_CACHE" = "1" ] || [ "$PRUNE_BUILD_CACHE" = "true" ]; then
  echo "==> Limiting Docker build cache to $BUILD_CACHE_KEEP_STORAGE"
  docker builder prune -f --keep-storage "$BUILD_CACHE_KEEP_STORAGE" >/dev/null || true
else
  echo "==> Skipping Docker build cache cleanup"
fi

echo "==> Docker disk usage"
docker system df || true

echo "Deploy finished."
