#!/usr/bin/env bash
# auditor.sh — Orchestrate audit dimensions for a single repo
set -euo pipefail

# Source dimension modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/dimensions/functional.sh"
source "${SCRIPT_DIR}/dimensions/non_functional.sh"
source "${SCRIPT_DIR}/dimensions/feature_ideas.sh"
source "${SCRIPT_DIR}/dimensions/documentation.sh"
source "${SCRIPT_DIR}/dimensions/cross_references.sh"
source "${SCRIPT_DIR}/dimensions/web_insights.sh"

# Run all configured audit dimensions on a single repo
# Usage: auditor_run <repo_dir> <repo_name>
# Outputs combined JSON findings to a file at ${WORKSPACE}/.findings/<repo_name>.json
auditor_run() {
  local repo_dir="$1"
  local repo_name="$2"

  local findings_dir="${WORKSPACE}/.findings"
  mkdir -p "$findings_dir"

  local all_findings="[]"

  for dimension in "${DIMENSIONS[@]}"; do
    # Check budget before each dimension
    if ! cost_check_budget; then
      log_warn "Budget exceeded — skipping remaining dimensions for ${repo_name}"
      break
    fi

    local dimension_findings=""
    case "$dimension" in
      functional)
        dimension_findings="$(audit_functional "$repo_dir" "$repo_name")" || true
        ;;
      non_functional)
        dimension_findings="$(audit_non_functional "$repo_dir" "$repo_name")" || true
        ;;
      feature_ideas)
        dimension_findings="$(audit_feature_ideas "$repo_dir" "$repo_name")" || true
        ;;
      documentation)
        dimension_findings="$(audit_documentation "$repo_dir" "$repo_name")" || true
        ;;
      cross_references)
        dimension_findings="$(audit_cross_references "$repo_dir" "$repo_name")" || true
        ;;
      web_insights)
        dimension_findings="$(audit_web_insights "$repo_dir" "$repo_name")" || true
        ;;
      *)
        log_warn "Unknown dimension: $dimension"
        continue
        ;;
    esac

    # Parse and merge findings
    if [[ -n "$dimension_findings" ]]; then
      local parsed
      parsed="$(echo "$dimension_findings" | jq '.findings // []' 2>/dev/null)" || {
        log_warn "Failed to parse ${dimension} findings for ${repo_name}"
        log_warn "Raw output: $(echo "$dimension_findings" | head -5)"
        continue
      }
      all_findings="$(echo "$all_findings" | jq --argjson new "$parsed" '. + $new')"
      log_info "  ${dimension}: $(echo "$parsed" | jq 'length') finding(s)"
    fi
  done

  # Write combined findings
  local findings_file="${findings_dir}/${repo_name}.json"
  jq -nc \
    --arg repo "$repo_name" \
    --arg date "$AUDIT_DATE" \
    --argjson findings "$all_findings" \
    '{
      repo: $repo,
      audit_date: $date,
      total_findings: ($findings | length),
      findings: $findings
    }' > "$findings_file"

  log_info "  Total findings for ${repo_name}: $(echo "$all_findings" | jq 'length')"
  echo "$findings_file"
}

# Build pre-audit summaries for all target repos (lightweight pass)
auditor_build_summaries() {
  log_step "Building repo ecosystem summaries..."

  local summaries_dir="${WORKSPACE}/.summaries"
  mkdir -p "$summaries_dir"

  for repo_name in "${TARGET_REPOS[@]}"; do
    local repo_dir="${WORKSPACE}/${repo_name}"
    if [[ -d "$repo_dir" ]]; then
      discovery_repo_summary "$repo_dir" "$repo_name" > "${summaries_dir}/${repo_name}.json"
      log_info "  Summary built for ${repo_name}"
    fi
  done
}
