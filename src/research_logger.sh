#!/usr/bin/env bash
# research_logger.sh — Write structured JSONL research logs
set -euo pipefail

# Log a web search and its results
# Usage: research_log <repo> <dimension> <query> <results_json> [informed_spec]
research_log() {
  local repo="$1"
  local dimension="$2"
  local query="$3"
  local results_json="$4"
  local informed_spec="${5:-}"

  local log_file="${LOG_DIR}/${repo}.jsonl"

  jq -nc \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg repo "$repo" \
    --arg dimension "$dimension" \
    --arg query "$query" \
    --argjson results "$results_json" \
    --arg informed_spec "$informed_spec" \
    --arg model "$MODEL" \
    '{
      timestamp: $timestamp,
      repo: $repo,
      dimension: $dimension,
      query: $query,
      results: $results,
      informed_spec: $informed_spec,
      model: $model
    }' >> "$log_file"
}

# Log a raw agent interaction (for debugging/traceability)
research_log_agent_call() {
  local repo="$1"
  local dimension="$2"
  local input_tokens="$3"
  local output_tokens="$4"

  local log_file="${LOG_DIR}/${repo}.jsonl"

  jq -nc \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg repo "$repo" \
    --arg dimension "$dimension" \
    --arg type "agent_call" \
    --argjson input_tokens "$input_tokens" \
    --argjson output_tokens "$output_tokens" \
    --arg model "$MODEL" \
    '{
      timestamp: $timestamp,
      type: $type,
      repo: $repo,
      dimension: $dimension,
      model: $model,
      tokens_used: {input: $input_tokens, output: $output_tokens}
    }' >> "$log_file"
}
