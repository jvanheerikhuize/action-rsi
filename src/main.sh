#!/usr/bin/env bash
# main.sh — RSI (Recursive Self-Improvement) audit entrypoint
# Orchestrates: discovery → summary → audit → spec generation → PR creation
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source all modules
source "${SCRIPT_DIR}/utils.sh"
source "${SCRIPT_DIR}/config.sh"
source "${SCRIPT_DIR}/cost_tracker.sh"
source "${SCRIPT_DIR}/research_logger.sh"
source "${SCRIPT_DIR}/discovery.sh"
source "${SCRIPT_DIR}/agent.sh"
source "${SCRIPT_DIR}/auditor.sh"
source "${SCRIPT_DIR}/spec_generator.sh"
source "${SCRIPT_DIR}/pr_manager.sh"

main() {
  log_step "=== RSI Audit Starting ==="

  # Load and validate config
  config_load
  config_validate
  config_summary

  # Initialize cost tracker
  cost_init

  # Trap cleanup on exit
  trap 'config_cleanup; cost_cleanup' EXIT

  # Phase 1: Discover repos
  log_step "Phase 1: Repo Discovery"
  discovery_fetch_repos
  discovery_filter_repos

  if [[ ${#TARGET_REPOS[@]} -eq 0 ]]; then
    log_warn "No target repos to audit"
    exit 0
  fi

  # Phase 2: Clone all target repos
  log_step "Phase 2: Cloning Repos"
  local cloned_repos=()
  for repo in "${TARGET_REPOS[@]}"; do
    if discovery_clone_repo "$repo"; then
      cloned_repos+=("$repo")
    else
      log_warn "Skipping ${repo} — clone failed"
      REPOS_FAILED=$((REPOS_FAILED + 1))
    fi
  done

  # Phase 3: Build ecosystem summaries (for cross-reference dimension)
  log_step "Phase 3: Building Ecosystem Summaries"
  auditor_build_summaries

  # Phase 4: Audit each repo
  log_step "Phase 4: Running Audits"
  for repo in "${cloned_repos[@]}"; do
    # Budget check before starting a new repo
    if ! cost_check_budget; then
      log_warn "Budget limit reached — skipping ${repo} and remaining repos"
      REPOS_SKIPPED_BUDGET=$((REPOS_SKIPPED_BUDGET + 1))
      continue
    fi

    log_step "Auditing: ${repo}"
    local repo_dir="${WORKSPACE}/${repo}"
    local findings_file

    findings_file="$(auditor_run "$repo_dir" "$repo")" || {
      log_error "Audit failed for ${repo}"
      REPOS_FAILED=$((REPOS_FAILED + 1))
      continue
    }

    REPOS_AUDITED=$((REPOS_AUDITED + 1))

    # Phase 5: Generate specs
    log_step "Generating specs for ${repo}..."
    local specs_created
    specs_created="$(spec_generate_all "$repo_dir" "$repo" "$findings_file")" || {
      log_error "Spec generation failed for ${repo}"
      continue
    }
    SPECS_GENERATED=$((SPECS_GENERATED + specs_created))

    # Phase 6: Create PR if specs were generated
    if [[ "$specs_created" -gt 0 ]]; then
      log_step "Creating PR for ${repo}..."
      local spec_files=()
      while IFS= read -r f; do
        spec_files+=("$f")
      done < <(find "${repo_dir}/specs/features" -name 'FEAT-*.yaml' -newer "$findings_file" 2>/dev/null)

      pr_create "$repo_dir" "$repo" "${spec_files[@]}" || {
        log_error "PR creation failed for ${repo}"
      }
    fi
  done

  # Summary
  log_step "=== RSI Audit Complete ==="
  log_info "Repos discovered:       $REPOS_DISCOVERED"
  log_info "Repos audited:          $REPOS_AUDITED"
  log_info "Specs generated:        $SPECS_GENERATED"
  log_info "PRs opened:             $PRS_OPENED"
  log_info "Repos failed:           $REPOS_FAILED"
  log_info "Repos skipped (budget): $REPOS_SKIPPED_BUDGET"
  cost_summary

  # Write GitHub Actions summary if running in CI
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    cat >> "$GITHUB_STEP_SUMMARY" <<EOF
## RSI Audit Summary — ${AUDIT_DATE}

| Metric | Value |
|--------|-------|
| Repos discovered | ${REPOS_DISCOVERED} |
| Repos audited | ${REPOS_AUDITED} |
| Specs generated | ${SPECS_GENERATED} |
| PRs opened | ${PRS_OPENED} |
| Repos failed | ${REPOS_FAILED} |
| Repos skipped (budget) | ${REPOS_SKIPPED_BUDGET} |
| Total cost | \$$(printf '%.4f' "$(cost_get_total)") USD |
EOF
  fi
}

main "$@"
