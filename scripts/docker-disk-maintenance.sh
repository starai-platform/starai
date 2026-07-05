#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-report}"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BUILD_CACHE_KEEP_STORAGE="${BUILD_CACHE_KEEP_STORAGE:-4GB}"
UNUSED_IMAGE_AGE="${UNUSED_IMAGE_AGE:-168h}"
STOPPED_CONTAINER_AGE="${STOPPED_CONTAINER_AGE:-168h}"

usage() {
  cat <<'EOF'
StarAI Docker 磁盘分析与清理

用法：
  bash scripts/docker-disk-maintenance.sh report
  bash scripts/docker-disk-maintenance.sh safe-clean
  bash scripts/docker-disk-maintenance.sh deep-clean

模式：
  report      只分析，不删除任何内容（默认）
  safe-clean  清理悬空镜像、旧构建缓存和超过 7 天的已停止容器
  deep-clean  在 safe-clean 基础上，清理超过 7 天且未被任何容器使用的镜像

环境变量：
  BUILD_CACHE_KEEP_STORAGE=4GB   构建缓存保留上限
  UNUSED_IMAGE_AGE=168h          deep-clean 未使用镜像最短保留时间
  STOPPED_CONTAINER_AGE=168h     已停止容器最短保留时间
  PROJECT_DIR=/www/wwwroot/starai

安全保证：
  - 不执行 docker volume prune
  - 不删除 PostgreSQL、Redis、MinIO 数据卷
  - 不删除项目 data/uploads 和 backups
  - report 模式不会执行任何删除
EOF
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "错误：未找到 docker 命令。" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "错误：Docker 服务不可用，或当前用户没有 Docker 权限。" >&2
    exit 1
  fi
}

directory_size() {
  local path="$1"
  if [ -e "$path" ]; then
    du -sh "$path" 2>/dev/null || true
  else
    printf '%s\t%s\n' "0" "$path（不存在）"
  fi
}

report() {
  echo "========== Docker 总体占用 =========="
  docker system df

  echo
  echo "========== 镜像明细（重点看 UNIQUE SIZE） =========="
  docker system df -v

  echo
  echo "========== 镜像列表 =========="
  docker image ls --digests

  echo
  echo "========== 容器可写层 =========="
  docker ps -a --size

  echo
  echo "========== Docker 根目录 =========="
  docker info --format 'DockerRootDir={{.DockerRootDir}}'

  echo
  echo "========== Docker 容器日志文件 =========="
  local docker_root
  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -n "$docker_root" ] && [ -d "$docker_root/containers" ]; then
    find "$docker_root/containers" -type f -name '*-json.log' -printf '%s %p\n' 2>/dev/null \
      | sort -nr \
      | head -20 \
      | awk '{ size=$1; $1=""; printf "%.2f MB%s\n", size/1024/1024, $0 }'
  else
    echo "无法直接读取容器日志目录；可使用 root 用户重新执行以查看。"
  fi

  echo
  echo "========== StarAI 本地数据目录 =========="
  directory_size "$PROJECT_DIR/data"
  directory_size "$PROJECT_DIR/data/uploads"
  directory_size "$PROJECT_DIR/backups"

  echo
  echo "提示：镜像列表中的 SIZE 会重复计算共享层，判断真实占用请以 docker system df 的 RECLAIMABLE 和 UNIQUE SIZE 为准。"
}

safe_clean() {
  echo "开始安全清理：不会删除任何 Docker volume 或 StarAI 数据目录。"

  echo "==> 清理超过 $STOPPED_CONTAINER_AGE 的已停止容器"
  docker container prune -f --filter "until=$STOPPED_CONTAINER_AGE"

  echo "==> 清理悬空镜像"
  docker image prune -f

  echo "==> 将 BuildKit 构建缓存限制到 $BUILD_CACHE_KEEP_STORAGE"
  docker builder prune -f --keep-storage "$BUILD_CACHE_KEEP_STORAGE"
}

deep_clean() {
  safe_clean
  echo "==> 清理超过 $UNUSED_IMAGE_AGE 且未被任何容器使用的镜像"
  docker image prune -a -f --filter "until=$UNUSED_IMAGE_AGE"
}

require_docker

case "$MODE" in
  report)
    report
    ;;
  safe-clean)
    report
    echo
    safe_clean
    echo
    report
    ;;
  deep-clean)
    report
    echo
    deep_clean
    echo
    report
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "错误：未知模式 $MODE" >&2
    usage
    exit 2
    ;;
esac
