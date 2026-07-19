#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"
BOT_DIR="$ROOT/bots/Surfski"
BACKUP_DIR="$ROOT/backups/surfski-memory/$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$BOT_DIR" ]]; then
  echo "Bot dir not found: $BOT_DIR"
  echo "Run from the mindcraft-plus repo root, or pass repo path:"
  echo "  ./scripts/reset-surfski-memory.sh ~/Code/Project/mindcraft-plus"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

backup_file() {
  local f="$1"
  if [[ -f "$BOT_DIR/$f" ]]; then
    cp -a "$BOT_DIR/$f" "$BACKUP_DIR/$f"
    echo "Backed up $f"
  fi
}

backup_file "memory.json"
backup_file "last_profile.json"
backup_file "self_prompts.json"
backup_file "history.json"

# Keep durable active goal/task state by default.
# Remove this file manually only if you want to erase the active goal too:
#   rm bots/Surfski/task_state.json

rm -f "$BOT_DIR/memory.json"
rm -f "$BOT_DIR/last_profile.json"
rm -f "$BOT_DIR/self_prompts.json"
rm -f "$BOT_DIR/history.json"

echo
echo "Surfski memory cleared."
echo "Backup saved to: $BACKUP_DIR"

if [[ -f "$BOT_DIR/task_state.json" ]]; then
  echo
  echo "Kept active task state:"
  echo "  $BOT_DIR/task_state.json"
fi
