#!/usr/bin/env bash
# utils.sh — Shared logging, display, and utility functions
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────
# GitHub Actions supports ANSI colors, so enable them there too.
# Only disable if explicitly requested or truly no color support.
if [[ "${NO_COLOR:-}" == "1" ]] || [[ "${TERM:-}" == "dumb" ]]; then
  RED='' GREEN='' YELLOW='' BLUE='' CYAN='' MAGENTA='' BOLD='' DIM='' NC=''
else
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  MAGENTA='\033[0;35m'
  BOLD='\033[1m'
  DIM='\033[2m'
  NC='\033[0m'
fi

# ── Symbols ─────────────────────────────────────────────────────────
SYM_CHECK="${GREEN}✓${NC}"
SYM_CROSS="${RED}✗${NC}"
SYM_ARROW="${CYAN}→${NC}"
SYM_WARN="${YELLOW}!${NC}"
SYM_SEARCH="${MAGENTA}◈${NC}"
SYM_TOOL="${DIM}↳${NC}"

# ── Core log functions ──────────────────────────────────────────────
log_info()  { echo -e "  ${DIM}$(date -u +%H:%M:%S)${NC}  $*" >&2; }
log_warn()  { echo -e "  ${YELLOW}$(date -u +%H:%M:%S)${NC}  ${SYM_WARN} $*" >&2; }
log_error() { echo -e "  ${RED}$(date -u +%H:%M:%S)${NC}  ${SYM_CROSS} $*" >&2; }
log_step()  { echo -e "  ${BLUE}${BOLD}$(date -u +%H:%M:%S)${NC}  $*" >&2; }

# ── Display helpers ─────────────────────────────────────────────────
# Width for box drawing
BOX_W=62

# Print a blank line
blank() { echo "" >&2; }

# Print a horizontal rule
hr() {
  local char="${1:-━}"
  printf -v line '%*s' "$BOX_W" ''
  echo -e "${DIM}${line// /$char}${NC}" >&2
}

# Print a phase header
phase() {
  local num="$1" title="$2"
  blank
  echo -e "${BOLD}${BLUE}[$num]${NC} ${BOLD}$title${NC}" >&2
  hr "─"
}

# Print a banner box
banner() {
  local title="$1"
  local subtitle="${2:-}"
  local pad_title pad_sub

  local inner=$((BOX_W - 4))
  printf -v pad_title '%*s' $(( (inner - ${#title}) / 2 )) ''
  blank
  echo -e "${BOLD}${CYAN}╔$(printf '%*s' $((BOX_W - 2)) '' | tr ' ' '═')╗${NC}" >&2
  echo -e "${BOLD}${CYAN}║${NC}${pad_title}${BOLD}${title}${NC}$(printf '%*s' $((inner - ${#title} - ${#pad_title})) '')${BOLD}${CYAN}  ║${NC}" >&2
  if [[ -n "$subtitle" ]]; then
    printf -v pad_sub '%*s' $(( (inner - ${#subtitle}) / 2 )) ''
    echo -e "${BOLD}${CYAN}║${NC}${pad_sub}${DIM}${subtitle}${NC}$(printf '%*s' $((inner - ${#subtitle} - ${#pad_sub})) '')${BOLD}${CYAN}  ║${NC}" >&2
  fi
  echo -e "${BOLD}${CYAN}╚$(printf '%*s' $((BOX_W - 2)) '' | tr ' ' '═')╝${NC}" >&2
}

# Print a result line with checkmark
ok() { echo -e "  ${SYM_CHECK} $*" >&2; }

# Print a result line with arrow
arrow() { echo -e "  ${SYM_ARROW} $*" >&2; }

# Print a result line with warning
warn_line() { echo -e "  ${SYM_WARN} $*" >&2; }

# Print a result line with cross
fail_line() { echo -e "  ${SYM_CROSS} $*" >&2; }

# Print a tool call line (indented, dimmed)
tool_line() { echo -e "    ${SYM_TOOL} ${DIM}$*${NC}" >&2; }

# Print a search result line
search_line() { echo -e "    ${SYM_SEARCH} $*" >&2; }

# Print a key-value pair for config display
kv() {
  local key="$1" value="$2"
  printf "  ${BOLD}%-16s${NC} %s\n" "$key" "$value" >&2
}

# Print a repo section header
repo_header() {
  local repo="$1"
  blank
  echo -e "  ${BOLD}${CYAN}┌─${NC} ${BOLD}$repo${NC}" >&2
}

# Print a repo section line
repo_line() { echo -e "  ${CYAN}│${NC}  $*" >&2; }

# Print a repo section footer
repo_footer() {
  echo -e "  ${CYAN}└$( printf '%*s' $((BOX_W - 4)) '' | tr ' ' '─' )${NC}" >&2
}

# Print a summary stat line
stat_line() {
  local label="$1" value="$2" color="${3:-$NC}"
  printf "  ${BOLD}%-24s${NC} ${color}%s${NC}\n" "$label" "$value" >&2
}

# Print a completion box
summary_box() {
  local status_color="${1:-$GREEN}"
  local title="${2:-Audit Complete}"
  local inner=$((BOX_W - 4))
  printf -v pad '%*s' $(( (inner - ${#title}) / 2 )) ''
  blank
  echo -e "${BOLD}${status_color}╔$(printf '%*s' $((BOX_W - 2)) '' | tr ' ' '═')╗${NC}" >&2
  echo -e "${BOLD}${status_color}║${NC}${pad}${BOLD}${title}${NC}$(printf '%*s' $((inner - ${#title} - ${#pad})) '')${BOLD}${status_color}  ║${NC}" >&2
  echo -e "${BOLD}${status_color}╚$(printf '%*s' $((BOX_W - 2)) '' | tr ' ' '═')╝${NC}" >&2
}

# ── Utility functions ───────────────────────────────────────────────

# Strip markdown code fences from LLM responses (```json ... ```)
strip_code_fences() { # shellcheck disable=SC2016
  sed 's/^```json[[:space:]]*//; s/^```[[:space:]]*$//; /^$/d'
}

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

# Mask sensitive tokens in a string (for safe logging)
mask_secrets() {
  sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-***/g; s/ghp_[A-Za-z0-9]+/ghp_***/g; s/gho_[A-Za-z0-9]+/gho_***/g; s/github_pat_[A-Za-z0-9_]+/github_pat_***/g'
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
