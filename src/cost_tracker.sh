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

# Print a visual budget bar
_cost_bar() {
  local spent="$1" budget="$2"
  local pct
  pct="$(awk "BEGIN {p=($spent/$budget)*100; if(p>100) p=100; printf \"%.0f\", p}")"
  local filled=$(( pct * 20 / 100 ))
  local empty=$(( 20 - filled ))
  local bar=""
  local bar_color="$GREEN"
  if [[ "$pct" -ge 80 ]]; then bar_color="$RED"
  elif [[ "$pct" -ge 50 ]]; then bar_color="$YELLOW"
  fi
  printf -v bar '%*s' "$filled" ''; bar="${bar// /█}"
  local empty_bar; printf -v empty_bar '%*s' "$empty" ''; empty_bar="${empty_bar// /░}"
  echo -e "  ${bar_color}${bar}${DIM}${empty_bar}${NC}  ${bar_color}${pct}%%${NC} of \$${budget}" >&2
}

# Print cost summary
cost_summary() {
  local total_input total_output total_cost
  total_input="$(jq -r '.total_input_tokens' "$COST_FILE")"
  total_output="$(jq -r '.total_output_tokens' "$COST_FILE")"
  total_cost="$(jq -r '.total_cost_usd' "$COST_FILE")"

  local formatted_cost
  formatted_cost="$(printf '%.4f' "$total_cost")"

  # Budget bar
  _cost_bar "$total_cost" "$BUDGET_USD"
  blank

  # Token breakdown
  local input_k output_k
  input_k="$(awk "BEGIN {printf \"%.1f\", $total_input / 1000}")"
  output_k="$(awk "BEGIN {printf \"%.1f\", $total_output / 1000}")"
  stat_line "Total cost" "\$${formatted_cost} USD"
  stat_line "Tokens" "${input_k}K in / ${output_k}K out"

  # Per-repo breakdown
  blank
  echo -e "  ${BOLD}Per-repo breakdown:${NC}" >&2
  jq -r '.per_repo | to_entries | sort_by(-.value.cost_usd)[] |
    "\(.key)|\(.value.cost_usd)|\(.value.input_tokens)|\(.value.output_tokens)"' "$COST_FILE" | \
  while IFS='|' read -r name cost input output; do
    local fcost input_k output_k
    fcost="$(printf '%.4f' "$cost")"
    input_k="$(awk "BEGIN {printf \"%.1f\", $input / 1000}")"
    output_k="$(awk "BEGIN {printf \"%.1f\", $output / 1000}")"
    echo -e "    ${SYM_DOT} ${BOLD}${name}${NC}  \$${fcost}  ${DIM}(${input_k}K in / ${output_k}K out)${NC}" >&2
  done
}

cost_cleanup() {
  [[ -f "${COST_FILE:-}" ]] && rm -f "$COST_FILE"
}
