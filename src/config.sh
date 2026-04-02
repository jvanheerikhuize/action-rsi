#!/usr/bin/env bash
# config.sh — Load and validate rsi.config.yaml
set -euo pipefail

# Resolve paths relative to repo root
RSI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RSI_CONFIG="${RSI_ROOT}/rsi.config.yaml"

config_load() {
  if [[ ! -f "$RSI_CONFIG" ]]; then
    log_error "Config file not found: $RSI_CONFIG"
    return 1
  fi

  # Core settings
  GITHUB_USERNAME="$(yq -r '.github_username // "jvanheerikhuize"' "$RSI_CONFIG")"
  TEST_MODE="$(yq -r '.test_mode // true' "$RSI_CONFIG")"
  BUDGET_USD="$(yq -r '.budget_usd // 10' "$RSI_CONFIG")"
  MODEL="$(yq -r '.model // "claude-sonnet-4-20250514"' "$RSI_CONFIG")"
  MAX_SPECS_PER_REPO="$(yq -r '.max_specs_per_repo // 5' "$RSI_CONFIG")"

  # Arrays — read into bash arrays
  mapfile -t TEST_REPOS < <(yq -r '.test_repos[]' "$RSI_CONFIG" 2>/dev/null || true)
  mapfile -t EXCLUDE_REPOS < <(yq -r '.exclude_repos[]' "$RSI_CONFIG" 2>/dev/null || true)
  mapfile -t DIMENSIONS < <(yq -r '.dimensions[]' "$RSI_CONFIG" 2>/dev/null || true)

  # Defaults if arrays are empty
  if [[ ${#TEST_REPOS[@]} -eq 0 ]]; then
    TEST_REPOS=("dotfiles" "a-sdlc")
  fi
  if [[ ${#DIMENSIONS[@]} -eq 0 ]]; then
    DIMENSIONS=("functional" "non_functional" "feature_ideas" "documentation" "cross_references" "web_insights")
  fi

  # SearXNG URL (for web search)
  local config_searxng
  config_searxng="$(yq -r '.searxng_url // ""' "$RSI_CONFIG" 2>/dev/null || true)"
  if [[ -n "$config_searxng" ]]; then
    SEARXNG_URL="$config_searxng"
  fi

  # Override from environment variables (GitHub Actions inputs)
  TEST_MODE="${RSI_TEST_MODE:-$TEST_MODE}"
  BUDGET_USD="${RSI_BUDGET_USD:-$BUDGET_USD}"
  MODEL="${RSI_MODEL:-$MODEL}"
  SEARXNG_URL="${SEARXNG_URL:-}"

  # Workspace for cloned repos
  WORKSPACE="$(mktemp -d /tmp/rsi-workspace.XXXXXX)"

  # Logs directory
  AUDIT_DATE="$(date -u +%Y-%m-%d)"
  LOG_DIR="${RSI_ROOT}/logs/research/${AUDIT_DATE}"
  mkdir -p "$LOG_DIR"

  # Summary counters
  REPOS_DISCOVERED=0
  REPOS_AUDITED=0
  SPECS_GENERATED=0
  PRS_OPENED=0
  REPOS_SKIPPED_BUDGET=0
  REPOS_FAILED=0

  export GITHUB_USERNAME TEST_MODE BUDGET_USD MODEL MAX_SPECS_PER_REPO
  export WORKSPACE AUDIT_DATE LOG_DIR RSI_ROOT
}

config_validate() {
  local errors=0

  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    log_error "ANTHROPIC_API_KEY is not set"
    errors=$((errors + 1))
  fi

  if [[ -z "${RSI_GITHUB_TOKEN:-}" ]] && [[ -z "${GITHUB_TOKEN:-}" ]]; then
    log_error "RSI_GITHUB_TOKEN (or GITHUB_TOKEN) is not set"
    errors=$((errors + 1))
  fi

  # Use RSI_GITHUB_TOKEN if set, fall back to GITHUB_TOKEN
  GH_TOKEN="${RSI_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  export GH_TOKEN

  if ! command -v jq &>/dev/null; then
    log_error "jq is required but not installed"
    errors=$((errors + 1))
  fi

  if ! command -v yq &>/dev/null; then
    log_error "yq is required but not installed"
    errors=$((errors + 1))
  fi

  if ! command -v curl &>/dev/null; then
    log_error "curl is required but not installed"
    errors=$((errors + 1))
  fi

  return "$errors"
}

config_summary() {
  log_info "=== RSI Configuration ==="
  log_info "GitHub user:    $GITHUB_USERNAME"
  log_info "Test mode:      $TEST_MODE"
  log_info "Budget:         \$${BUDGET_USD} USD"
  log_info "Model:          $MODEL"
  log_info "Max specs/repo: $MAX_SPECS_PER_REPO"
  log_info "Dimensions:     ${DIMENSIONS[*]}"
  if [[ "$TEST_MODE" == "true" ]]; then
    log_info "Test repos:     ${TEST_REPOS[*]}"
  fi
  log_info "Workspace:      $WORKSPACE"
  log_info "Log dir:        $LOG_DIR"
  log_info "========================="
}

config_cleanup() {
  if [[ -d "${WORKSPACE:-}" ]]; then
    rm -rf "$WORKSPACE"
    log_info "Cleaned up workspace: $WORKSPACE"
  fi
}
