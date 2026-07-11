#!/usr/bin/env bash
set -euo pipefail

PACK_FILE="${1:-}"
if [ -z "$PACK_FILE" ] || [ ! -f "$PACK_FILE" ]; then
  echo "Usage: bash scripts/verify-full-backup.sh <starai-full-backup-*.tar.gz>" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if tar -tzf "$PACK_FILE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Backup contains an unsafe archive path." >&2
  exit 1
fi

tar -xzf "$PACK_FILE" -C "$TMP_DIR"
for required in starai-full.dump uploads.tar.gz env.production README.txt; do
  if [ ! -f "$TMP_DIR/$required" ]; then
    echo "Missing required backup member: $required" >&2
    exit 1
  fi
done

if [ ! -f "$TMP_DIR/SHA256SUMS" ]; then
  echo "Backup has no SHA256SUMS and cannot pass the current integrity check." >&2
  exit 1
fi
(cd "$TMP_DIR" && sha256sum -c SHA256SUMS)
tar -tzf "$TMP_DIR/uploads.tar.gz" >/dev/null

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$TMP_DIR/starai-full.dump" >/dev/null
else
  echo "NOTE: pg_restore is unavailable; database dump catalog validation was skipped." >&2
fi

echo "Backup verification passed: $PACK_FILE"
