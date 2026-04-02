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

# Friendly dimension labels
declare -A DIMENSION_LABELS=(
  [functional]="Functional"
  [non_functional]="Non-Functional"
  [feature_ideas]="Feature Ideas"
  [documentation]="Documentation"
  [cross_references]="Cross-References"
  [web_insights]="Web Insights"
)

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
      repo_line "${SYM_WARN} ${YELLOW}Budget exceeded — skipping remaining dimensions${NC}"
      break
    fi

    local label="${DIMENSION_LABELS[$dimension]:-$dimension}"
    repo_line "${SYM_SEARCH} ${BOLD}${label}${NC}"

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
        repo_line "${SYM_WARN} Unknown dimension: $dimension"
        continue
        ;;
    esac

    # Parse and merge findings
    if [[ -n "$dimension_findings" ]]; then
      local parsed
      parsed="$(echo "$dimension_findings" | jq '.findings // []' 2>/dev/null)" || {
        repo_line "  ${SYM_WARN} ${YELLOW}Failed to parse findings${NC}"
        continue
      }
      local count
      count="$(echo "$parsed" | jq 'length')"
      all_findings="$(echo "$all_findings" | jq --argjson new "$parsed" '. + $new')"

      if [[ "$count" -gt 0 ]]; then
        repo_line "  ${SYM_CHECK} ${GREEN}${count} finding(s)${NC}"
      else
        repo_line "  ${DIM}no findings${NC}"
      fi
    fi
  done

  # Write combined findings
  local findings_file="${findings_dir}/${repo_name}.json"
  local total
  total="$(echo "$all_findings" | jq 'length')"

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

  TOTAL_FINDINGS=$((TOTAL_FINDINGS + total))
  echo "$findings_file"
}

# Build pre-audit summaries for all target repos (lightweight pass)
auditor_build_summaries() {
  local summaries_dir="${WORKSPACE}/.summaries"
  mkdir -p "$summaries_dir"

  for repo_name in "${TARGET_REPOS[@]}"; do
    local repo_dir="${WORKSPACE}/${repo_name}"
    if [[ -d "$repo_dir" ]]; then
      discovery_repo_summary "$repo_dir" "$repo_name" > "${summaries_dir}/${repo_name}.json"
    fi
  done
}
