#!/usr/bin/env bash
# main.sh — RSI (Recursive Self-Improvement) audit entrypoint
# Architecture: static analysis → context builder → single-shot LLM
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source all modules
source "${SCRIPT_DIR}/utils.sh"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/cost_tracker.sh"
source "${SCRIPT_DIR}/research_logger.sh"
source "${SCRIPT_DIR}/discovery.sh"
source "${SCRIPT_DIR}/static_analysis.sh"
source "${SCRIPT_DIR}/context_builder.sh"
source "${SCRIPT_DIR}/llm_analyzer.sh"
source "${SCRIPT_DIR}/spec_generator.sh"
source "${SCRIPT_DIR}/pr_manager.sh"

# Build ecosystem summaries for all target repos
build_summaries() {
  local summaries_dir="${WORKSPACE}/.summaries"
  mkdir -p "$summaries_dir"

  for repo_name in "${TARGET_REPOS[@]}"; do
    local repo_dir="${WORKSPACE}/${repo_name}"
    if [[ -d "$repo_dir" ]]; then
      discovery_repo_summary "$repo_dir" "$repo_name" > "${summaries_dir}/${repo_name}.json"
    fi
  done
}

main() {
  banner "RSI — Recursive Self-Improvement" "Audit Pipeline"

  # Load and validate config
  config_load
  config_validate
  config_summary

  # Initialize cost tracker
  cost_init

  # Trap cleanup on exit
  trap 'config_cleanup; cost_cleanup' EXIT

  # ── Phase 1: Discovery ──────────────────────────────────────────
  phase 1 "Discovery"
  discovery_fetch_repos
  discovery_filter_repos

  if [[ ${#TARGET_REPOS[@]} -eq 0 ]]; then
    warn_line "No target repos to audit"
    exit 0
  fi

  # ── Phase 2: Clone ──────────────────────────────────────────────
  phase 2 "Clone"
  local cloned_repos=()
  for repo in "${TARGET_REPOS[@]}"; do
    if discovery_clone_repo "$repo"; then
      cloned_repos+=("$repo")
    else
      fail_line "${repo} — clone failed"
      REPOS_FAILED=$((REPOS_FAILED + 1))
    fi
  done

  # ── Phase 3: Ecosystem Summaries ────────────────────────────────
  phase 3 "Ecosystem Summaries"
  build_summaries

  # ── Phase 4: Static Analysis (FREE) ─────────────────────────────
  phase 4 "Static Analysis"
  local -A static_results=()
  local total_static_findings=0
  for repo in "${cloned_repos[@]}"; do
    repo_header "$repo"
    local repo_dir="${WORKSPACE}/${repo}"
    local sa_output
    sa_output="$(sa_run "$repo_dir" "$repo")"
    static_results[$repo]="$sa_output"
    local count; count="$(echo "$sa_output" | jq '.total_findings')"
    total_static_findings=$((total_static_findings + count))
    repo_footer
  done
  arrow "Total static findings: ${BOLD}${total_static_findings}${NC} ${DIM}(free)${NC}"

  # ── Phase 5: Context Building ───────────────────────────────────
  phase 5 "Context Building"
  local -A context_bundles=()
  for repo in "${cloned_repos[@]}"; do
    repo_header "$repo"
    local repo_dir="${WORKSPACE}/${repo}"
    local bundle
    bundle="$(ctx_build "$repo_dir" "$repo" "${static_results[$repo]}")"
    context_bundles[$repo]="$bundle"
    repo_footer
  done

  # ── Phase 6: LLM Analysis (single-shot) ─────────────────────────
  phase 6 "LLM Analysis"
  for repo in "${cloned_repos[@]}"; do
    # Budget check
    if ! cost_check_budget; then
      warn_line "Budget limit reached — skipping ${repo} and remaining repos"
      REPOS_SKIPPED_BUDGET=$((REPOS_SKIPPED_BUDGET + 1))
      continue
    fi

    repo_header "$repo"
    local repo_dir="${WORKSPACE}/${repo}"

    # Single-shot LLM call
    local llm_findings
    llm_findings="$(llm_analyze "$repo" "${context_bundles[$repo]}")" || {
      repo_line "${SYM_CROSS} LLM analysis failed"
      REPOS_FAILED=$((REPOS_FAILED + 1))
      repo_footer
      continue
    }

    REPOS_AUDITED=$((REPOS_AUDITED + 1))

    # Merge static + LLM findings
    local static_as_findings
    static_as_findings="$(echo "${static_results[$repo]}" | jq '[.findings[] | {
      dimension: "static_analysis",
      severity: .severity,
      category: .category,
      title: (.code + ": " + .title),
      description: .description,
      files_affected: [.file],
      recommendation: (if .fix then "Fix: " + .fix else "Address the " + .source + " finding" end)
    }]')"

    local llm_parsed
    llm_parsed="$(echo "$llm_findings" | jq '.findings // []' 2>/dev/null)" || llm_parsed="[]"

    local all_findings
    all_findings="$(jq -nc --argjson static "$static_as_findings" --argjson llm "$llm_parsed" '$static + $llm')"

    local total_count
    total_count="$(echo "$all_findings" | jq 'length')"
    TOTAL_FINDINGS=$((TOTAL_FINDINGS + total_count))

    # Write combined findings file
    local findings_dir="${WORKSPACE}/.findings"
    mkdir -p "$findings_dir"
    local findings_file="${findings_dir}/${repo}.json"
    jq -nc \
      --arg repo "$repo" \
      --arg date "$AUDIT_DATE" \
      --argjson findings "$all_findings" \
      '{
        repo: $repo,
        audit_date: $date,
        total_findings: ($findings | length),
        findings: $findings
      }' > "$findings_file"

    # ── Generate specs ──────────────────────────────────────────
    local specs_created
    specs_created="$(spec_generate_all "$repo_dir" "$repo" "$findings_file")" || {
      repo_line "${SYM_CROSS} Spec generation failed"
      repo_footer
      continue
    }
    SPECS_GENERATED=$((SPECS_GENERATED + specs_created))

    # ── Create PR if specs were generated ───────────────────────
    if [[ "$specs_created" -gt 0 ]]; then
      local spec_files=()
      while IFS= read -r f; do
        spec_files+=("$f")
      done < <(find "${repo_dir}/specs/features" -name 'FEAT-*.yaml' -newer "$findings_file" 2>/dev/null)

      pr_create "$repo_dir" "$repo" "${spec_files[@]}" || {
        repo_line "${SYM_CROSS} PR creation failed"
      }
    fi

    repo_footer
  done

  # ── Summary ─────────────────────────────────────────────────────
  local status_color="$GREEN"
  local status_label="Audit Complete"
  if [[ "$REPOS_FAILED" -gt 0 ]]; then
    status_color="$YELLOW"
    status_label="Audit Complete (with errors)"
  fi

  summary_box "$status_color" "$status_label"
  blank

  stat_line "Repos discovered" "$REPOS_DISCOVERED"
  stat_line "Repos audited" "$REPOS_AUDITED"
  stat_line "Static findings" "${total_static_findings} (free)"
  stat_line "LLM findings" "$((TOTAL_FINDINGS - total_static_findings))"
  stat_line "Total findings" "$TOTAL_FINDINGS"
  stat_line "Specs generated" "$SPECS_GENERATED"
  stat_line "PRs opened" "$PRS_OPENED"
  if [[ "$REPOS_FAILED" -gt 0 ]]; then
    stat_line "Repos failed" "$REPOS_FAILED" "$RED"
  fi
  if [[ "$REPOS_SKIPPED_BUDGET" -gt 0 ]]; then
    stat_line "Skipped (budget)" "$REPOS_SKIPPED_BUDGET" "$YELLOW"
  fi

  blank
  echo -e "  ${BOLD}Cost${NC}" >&2
  hr "─"
  cost_summary
  blank

  # Write GitHub Actions summary if running in CI
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    local total_cost
    total_cost="$(printf '%.4f' "$(cost_get_total)")"
    local pct
    pct="$(awk "BEGIN {printf \"%.0f\", ($(cost_get_total) / $BUDGET_USD) * 100}")"

    cat >> "$GITHUB_STEP_SUMMARY" <<EOF
## RSI Audit — ${AUDIT_DATE}

### Results

| Metric | Value |
|--------|------:|
| Repos discovered | ${REPOS_DISCOVERED} |
| Repos audited | ${REPOS_AUDITED} |
| Static findings (free) | ${total_static_findings} |
| LLM findings | $((TOTAL_FINDINGS - total_static_findings)) |
| Total findings | ${TOTAL_FINDINGS} |
| Specs generated | ${SPECS_GENERATED} |
| PRs opened | ${PRS_OPENED} |

### Cost

| | |
|---|---|
| **Total** | \$${total_cost} USD |
| **Budget used** | ${pct}% of \$${BUDGET_USD} |

EOF
    # Per-repo cost table
    if [[ "$(jq '.per_repo | length' "$COST_FILE")" -gt 0 ]]; then
      echo "### Per-repo breakdown" >> "$GITHUB_STEP_SUMMARY"
      echo "" >> "$GITHUB_STEP_SUMMARY"
      echo "| Repo | Cost | Tokens (in/out) |" >> "$GITHUB_STEP_SUMMARY"
      echo "|------|-----:|----------------:|" >> "$GITHUB_STEP_SUMMARY"
      jq -r '.per_repo | to_entries | sort_by(-.value.cost_usd)[] |
        "| \(.key) | $\(.value.cost_usd | tostring | .[0:8]) | \(.value.input_tokens)/\(.value.output_tokens) |"' \
        "$COST_FILE" >> "$GITHUB_STEP_SUMMARY"
    fi
  fi
}

main "$@"
