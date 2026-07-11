#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
BUILD_SERVICES="${BUILD_SERVICES:-api worker web admin}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-auto}"
STOP_SERVICES_BEFORE_BUILD="${STOP_SERVICES_BEFORE_BUILD:-0}"
NO_CACHE_SERVICES="${NO_CACHE_SERVICES:-}"
IMPORT_SETTINGS_PACK="${IMPORT_SETTINGS_PACK:-0}"
SETTINGS_PACK="${SETTINGS_PACK:-}"
PRUNE_BUILD_CACHE="${PRUNE_BUILD_CACHE:-1}"
BUILD_CACHE_KEEP_STORAGE="${BUILD_CACHE_KEEP_STORAGE:-4GB}"
AUTO_ROLLBACK="${AUTO_ROLLBACK:-1}"
ROLLBACK_STATE="$(mktemp)"

cleanup_deploy_state() {
  rm -f "$ROLLBACK_STATE"
}
trap cleanup_deploy_state EXIT

# 4C8G VPS can be killed by parallel Docker/Next/Go builds. Keep deploys
# predictable by default; override these env vars only on larger machines.
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.example and fill production values first." >&2
  exit 1
fi

env_value() {
  local key="$1"
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

warn() {
  echo "Warning: $*" >&2
}

app_env="$(env_value APP_ENV)"
public_api_url="$(env_value NEXT_PUBLIC_API_URL)"
database_url="$(env_value DATABASE_URL)"
redis_url="$(env_value REDIS_URL)"
postgres_password="$(env_value POSTGRES_PASSWORD)"
jwt_secret="$(env_value JWT_SECRET)"
admin_jwt_secret="$(env_value ADMIN_JWT_SECRET)"
base_url="$(env_value BASE_URL)"

if [ "$app_env" = "production" ]; then
  case "$base_url" in
    ""|https://yourdomain.com|http://yourdomain.com)
      echo "Invalid BASE_URL for production: ${base_url:-empty}" >&2
      echo "Set BASE_URL to your public domain, for example: https://yourdomain.com" >&2
      exit 1
      ;;
  esac
  case "$public_api_url" in
    http://localhost*|http://127.0.0.1*|http://0.0.0.0*|""|https://yourdomain.com|http://yourdomain.com)
      echo "Invalid NEXT_PUBLIC_API_URL for production: ${public_api_url:-empty}" >&2
      echo "Set NEXT_PUBLIC_API_URL to your public domain, for example: https://yourdomain.com" >&2
      exit 1
      ;;
  esac
  case "$postgres_password" in
    "")
      echo "Invalid POSTGRES_PASSWORD for production. Set POSTGRES_PASSWORD or keep the template default." >&2
      exit 1
      ;;
    starai|change_this_to_a_strong_password)
      warn "POSTGRES_PASSWORD is using a default value. This is allowed for quick deployment, but changing it is recommended before public production use."
      ;;
  esac
  case "$database_url" in
    *"@localhost:"*|*"@127.0.0.1:"*)
      echo "Invalid DATABASE_URL for Docker production: $database_url" >&2
      echo "Use the compose service host instead, for example: postgres://starai:<password>@postgres:5432/starai?sslmode=disable" >&2
      exit 1
      ;;
  esac
  case "$database_url" in
    *"change_this_to_a_strong_password"*)
      warn "DATABASE_URL is using the default PostgreSQL password. This is allowed for quick deployment, but changing it is recommended before public production use."
      ;;
  esac
  case "$database_url" in
    *"@postgres:"*) ;;
    *)
      echo "Invalid DATABASE_URL for Docker production: $database_url" >&2
      echo "Use the compose service host: postgres://starai:<password>@postgres:5432/starai?sslmode=disable" >&2
      exit 1
      ;;
  esac
  case "$redis_url" in
    redis://localhost*|redis://127.0.0.1*)
      echo "Invalid REDIS_URL for Docker production: $redis_url" >&2
      echo "Use the compose service host instead: redis://redis:6379/0" >&2
      exit 1
      ;;
  esac
  case "$jwt_secret" in
    "")
      echo "Invalid JWT_SECRET for production. Set JWT_SECRET or keep the template default." >&2
      exit 1
      ;;
    change-me-in-production-starai-jwt-secret|replace_with_a_long_random_secret|dev-jwt-secret-starai)
      warn "============================================================"
      warn "JWT_SECRET 仍为公开默认值，公网部署后用户令牌可能被伪造。"
      warn "本次一键部署将继续；正式运营前建议替换为随机长密钥。"
      warn "可生成密钥：openssl rand -hex 32"
      warn "============================================================"
      ;;
  esac
  case "$admin_jwt_secret" in
    "")
      echo "Invalid ADMIN_JWT_SECRET for production. Set ADMIN_JWT_SECRET or keep the template default." >&2
      exit 1
      ;;
    change-me-admin-jwt-secret|replace_with_another_long_random_secret|dev-admin-jwt-secret)
      warn "============================================================"
      warn "ADMIN_JWT_SECRET 仍为公开默认值，公网部署后管理员令牌可能被伪造。"
      warn "本次一键部署将继续；正式运营前建议替换为另一条随机长密钥。"
      warn "可生成密钥：openssl rand -hex 32"
      warn "============================================================"
      ;;
  esac
fi

echo "==> Checking compose config"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

echo "==> Starting PostgreSQL and Redis"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis

echo "==> Saving current application images for rollback"
for service in $BUILD_SERVICES; do
  container_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service" || true)"
  if [ -z "$container_id" ]; then
    continue
  fi
  image_id="$(docker inspect -f '{{.Image}}' "$container_id" 2>/dev/null || true)"
  image_ref="$(docker inspect -f '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
  if [ -z "$image_id" ] || [ -z "$image_ref" ]; then
    continue
  fi
  rollback_ref="starai-local-rollback-${service}:latest"
  docker tag "$image_id" "$rollback_ref"
  printf '%s|%s|%s\n' "$service" "$image_ref" "$rollback_ref" >> "$ROLLBACK_STATE"
  echo "  saved $service image=$image_id"
done

rollback_application_images() {
  if [ "$AUTO_ROLLBACK" != "1" ] && [ "$AUTO_ROLLBACK" != "true" ]; then
    echo "Automatic application rollback is disabled (AUTO_ROLLBACK=$AUTO_ROLLBACK)." >&2
    return 0
  fi
  if [ ! -s "$ROLLBACK_STATE" ]; then
    echo "No previous application images were available for rollback." >&2
    return 0
  fi
  echo "==> Rolling back application images (database migrations are not reversed)" >&2
  while IFS='|' read -r service image_ref rollback_ref; do
    [ -n "$service" ] || continue
    docker tag "$rollback_ref" "$image_ref"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$service" || true
    echo "  restored $service from $rollback_ref" >&2
  done < "$ROLLBACK_STATE"
}

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

echo "==> Waiting for application health checks"
for service in $BUILD_SERVICES; do
  container_id="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q "$service" || true)"
  if [ -z "$container_id" ]; then
    echo "Service $service did not start." >&2
    rollback_application_images
    exit 1
  fi
  healthy=false
  for _ in $(seq 1 30); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      healthy=true
      break
    fi
    if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
      break
    fi
    sleep 2
  done
  if [ "$healthy" != "true" ]; then
    echo "Service $service failed its health check. Existing data volumes were not removed." >&2
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=80 "$service" >&2 || true
    rollback_application_images
    exit 1
  fi
done

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
