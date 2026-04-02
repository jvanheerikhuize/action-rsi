#!/usr/bin/env bash
# cost_tracker.sh — Track Claude API token usage and enforce budget
set -euo pipefail

COST_FILE=""

# Pricing per million tokens (defaults for Claude Sonnet)
INPUT_COST_PER_M="${RSI_INPUT_COST_PER_M:-3.00}"
OUTPUT_COST_PER_M="${RSI_OUTPUT_COST_PER_M:-15.00}"

cost_init() {
  COST_FILE="$(mktemp /tmp/rsi-cost.XXXXXX)"
  echo '{"total_input_tokens":0,"total_output_tokens":0,"total_cost_usd":0.0,"per_repo":{}}' > "$COST_FILE"
}

# Record token usage from an API response
# Usage: cost_record <repo_name> <input_tokens> <output_tokens>
cost_record() {
  local repo="$1" input_tokens="$2" output_tokens="$3"

  local cost
  cost=$(awk "BEGIN {printf \"%.6f\", ($input_tokens / 1000000.0) * $INPUT_COST_PER_M + ($output_tokens / 1000000.0) * $OUTPUT_COST_PER_M}")

  local tmp
  tmp="$(mktemp)"
  jq --arg repo "$repo" \
     --argjson input "$input_tokens" \
     --argjson output "$output_tokens" \
     --argjson cost "$cost" \
     '
     .total_input_tokens += $input |
     .total_output_tokens += $output |
     .total_cost_usd += $cost |
     .per_repo[$repo].input_tokens = ((.per_repo[$repo].input_tokens // 0) + $input) |
     .per_repo[$repo].output_tokens = ((.per_repo[$repo].output_tokens // 0) + $output) |
     .per_repo[$repo].cost_usd = ((.per_repo[$repo].cost_usd // 0) + $cost)
     ' "$COST_FILE" > "$tmp"
  mv "$tmp" "$COST_FILE"
}

# Check if we're still within budget
# Returns 0 if within budget, 1 if exceeded
cost_check_budget() {
  local budget="${BUDGET_USD:-10}"
  local current
  current="$(jq -r '.total_cost_usd' "$COST_FILE")"

  if awk "BEGIN {exit !($current >= $budget)}"; then
    log_warn "Budget limit reached: \$${current} >= \$${budget}"
    return 1
  fi
  return 0
}

# Get current total cost
cost_get_total() {
  jq -r '.total_cost_usd' "$COST_FILE"
}

# Print cost summary
cost_summary() {
  log_info "=== Cost Summary ==="
  local total_input total_output total_cost
  total_input="$(jq -r '.total_input_tokens' "$COST_FILE")"
  total_output="$(jq -r '.total_output_tokens' "$COST_FILE")"
  total_cost="$(jq -r '.total_cost_usd' "$COST_FILE")"

  log_info "Total input tokens:  $total_input"
  log_info "Total output tokens: $total_output"
  log_info "Total cost:          \$$(printf '%.4f' "$total_cost") USD"
  log_info ""
  log_info "Per-repo breakdown:"
  jq -r '.per_repo | to_entries[] | "  \(.key): $\(.value.cost_usd | tostring | .[0:8]) (\(.value.input_tokens) in / \(.value.output_tokens) out)"' "$COST_FILE" | while read -r line; do
    log_info "$line"
  done
  log_info "===================="
}

cost_cleanup() {
  [[ -f "${COST_FILE:-}" ]] && rm -f "$COST_FILE"
}
