#!/usr/bin/env bash
# utils.sh — Shared logging and utility functions
set -euo pipefail

# Colors (disabled if not a terminal or in CI)
if [[ -t 1 ]] && [[ -z "${CI:-}" ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

log_info()  { echo -e "${GREEN}[INFO]${NC}  $(date -u +%H:%M:%S) $*" >&2; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $(date -u +%H:%M:%S) $*" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date -u +%H:%M:%S) $*" >&2; }
log_step()  { echo -e "${BLUE}${BOLD}[STEP]${NC}  $(date -u +%H:%M:%S) $*" >&2; }

# Retry a command with exponential backoff
# Usage: retry <max_attempts> <initial_delay_secs> <command...>
retry() {
  local max_attempts="$1" delay="$2"
  shift 2
  local attempt=1

  while true; do
    if "$@"; then
      return 0
    fi
    if [[ $attempt -ge $max_attempts ]]; then
      log_error "Command failed after $max_attempts attempts: $*"
      return 1
    fi
    log_warn "Attempt $attempt/$max_attempts failed, retrying in ${delay}s..."
    sleep "$delay"
    delay=$((delay * 3))
    attempt=$((attempt + 1))
  done
}

# Check if a value is in an array
# Usage: in_array "value" "${array[@]}"
in_array() {
  local needle="$1"
  shift
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

# Escape a string for safe JSON embedding
json_escape() {
  local str="$1"
  printf '%s' "$str" | jq -Rsa .
}

# Truncate text to a max character count
truncate_text() {
  local text="$1" max_chars="${2:-4000}"
  if [[ ${#text} -gt $max_chars ]]; then
    echo "${text:0:$max_chars}... [truncated]"
  else
    echo "$text"
  fi
}
