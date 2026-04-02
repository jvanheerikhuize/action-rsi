#!/usr/bin/env bash
# spec_generator.sh — Generate A-SDLC YAML spec files from audit findings
set -euo pipefail

# Determine the next FEAT-NNNN ID in a repo
# Usage: spec_next_id <repo_dir>
spec_next_id() {
  local repo_dir="$1"
  local max_id=0

  # Check specs/features/ for existing FEAT-*.yaml files
  if [[ -d "${repo_dir}/specs/features" ]]; then
    while IFS= read -r file; do
      local num
      num="$(basename "$file" | grep -oP 'FEAT-\K[0-9]+' || echo 0)"
      if [[ "$num" -gt "$max_id" ]]; then
        max_id="$num"
      fi
    done < <(find "${repo_dir}/specs/features" -name 'FEAT-*.yaml' 2>/dev/null)
  fi

  # Also check specs.config.yaml if it exists
  if [[ -f "${repo_dir}/specs.config.yaml" ]]; then
    local config_max
    config_max="$(yq -r '.specifications[]?.id // "" ' "${repo_dir}/specs.config.yaml" 2>/dev/null \
      | grep -oP 'FEAT-\K[0-9]+' | sort -n | tail -1)" || config_max=0
    if [[ "${config_max:-0}" -gt "$max_id" ]]; then
      max_id="$config_max"
    fi
  fi

  printf "FEAT-%04d" $((max_id + 1))
}

# Group related findings into spec-sized chunks
# Usage: spec_group_findings <findings_json>
# Outputs JSON array of grouped findings
spec_group_findings() {
  local findings_json="$1"

  # Group by dimension + category, then by severity
  echo "$findings_json" | jq '
    group_by(.category) |
    map({
      category: .[0].category,
      dimension: .[0].dimension // (.[0].category),
      severity: (map(.severity) | if any(. == "high") then "high"
                 elif any(. == "medium") then "medium"
                 else "low" end),
      findings: .
    }) |
    sort_by(if .severity == "high" then 0 elif .severity == "medium" then 1 else 2 end)
  '
}

# Generate a single spec file from grouped findings
# Usage: spec_generate <repo_dir> <repo_name> <spec_id> <grouped_findings_json>
spec_generate() {
  local repo_dir="$1"
  local repo_name="$2"
  local spec_id="$3"
  local group_json="$4"

  local category dimension severity title
  category="$(echo "$group_json" | jq -r '.category')"
  dimension="$(echo "$group_json" | jq -r '.dimension')"
  severity="$(echo "$group_json" | jq -r '.severity')"

  # Build spec title from first finding
  title="$(echo "$group_json" | jq -r '.findings[0].title')"

  # Determine priority from severity
  local priority="medium"
  case "$severity" in
    high)   priority="high" ;;
    medium) priority="medium" ;;
    low)    priority="low" ;;
  esac

  # Build problem statement from all findings in the group
  local problem
  problem="$(echo "$group_json" | jq -r '.findings | map("- " + .description) | join("\n")')"

  # Build recommendation / solution
  local solution
  solution="$(echo "$group_json" | jq -r '.findings | map("- " + .recommendation) | join("\n")')"

  # Build affected files list
  local files_affected
  files_affected="$(echo "$group_json" | jq '[.findings[].files_affected[]?] | unique')"

  # Build tags
  local tags
  tags="$(jq -nc --arg dim "$dimension" --arg cat "$category" '["rsi-audit", $dim, $cat]')"

  # Build acceptance criteria from findings
  local acceptance_criteria="[]"
  local ac_idx=1
  while IFS= read -r finding; do
    local ac_id
    ac_id="$(printf "AC-%03d" $ac_idx)"
    local finding_title
    finding_title="$(echo "$finding" | jq -r '.title')"
    local finding_rec
    finding_rec="$(echo "$finding" | jq -r '.recommendation')"
    local affected
    affected="$(echo "$finding" | jq -r '.files_affected[0] // "the codebase"')"

    acceptance_criteria="$(echo "$acceptance_criteria" | jq \
      --arg id "$ac_id" \
      --arg given "The ${affected} file(s) exist in the repository" \
      --arg when "The changes from this spec are applied" \
      --arg then "$finding_rec" \
      '. + [{id: $id, given: $given, when: $when, then: $then}]')"
    ac_idx=$((ac_idx + 1))
  done < <(echo "$group_json" | jq -c '.findings[]')

  # Slug for filename
  local slug
  slug="$(echo "$title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-50)"

  local spec_file="${repo_dir}/specs/features/${spec_id}-${slug}.yaml"
  mkdir -p "${repo_dir}/specs/features"

  # Write spec using yq to ensure valid YAML
  local spec_json
  spec_json="$(jq -nc \
    --arg spec_id "$spec_id" \
    --arg title "$title" \
    --arg priority "$priority" \
    --arg date "$AUDIT_DATE" \
    --argjson tags "$tags" \
    --arg problem "$problem" \
    --arg solution "$solution" \
    --argjson acceptance_criteria "$acceptance_criteria" \
    --argjson files_affected "$files_affected" \
    '{
      metadata: {
        id: $spec_id,
        title: $title,
        version: "1.0.0",
        status: "draft",
        priority: $priority,
        author: "RSI Audit Agent",
        created_at: $date,
        updated_at: $date,
        tags: $tags
      },
      description: {
        summary: ("Automated audit finding: " + $title),
        problem_statement: $problem,
        proposed_solution: $solution,
        out_of_scope: ["Changes unrelated to the identified findings"],
        dependencies: []
      },
      technical_requirements: {
        constraints: [],
        security: []
      },
      acceptance_criteria: $acceptance_criteria,
      technical_notes: ("Files affected: " + ($files_affected | join(", "))),
      testing_requirements: {
        unit_tests: true,
        integration_tests: false,
        e2e_tests: false,
        performance_tests: false,
        test_scenarios: ["Verify the fix addresses the identified issue"]
      },
      rollout: {
        rollout_strategy: "manual",
        rollback_plan: "Revert the changes introduced by this spec via git revert."
      }
    }')"

  echo "$spec_json" | yq -P '.' > "$spec_file"
  repo_line "${SYM_CHECK} ${BOLD}${spec_id}${NC} — ${title} ${DIM}(${priority})${NC}"
  echo "$spec_file"
}

# Generate specs for a repo from its findings file
# Usage: spec_generate_all <repo_dir> <repo_name> <findings_file>
# Outputs number of specs generated
spec_generate_all() {
  local repo_dir="$1"
  local repo_name="$2"
  local findings_file="$3"

  local findings
  findings="$(jq '.findings' "$findings_file")"
  local count
  count="$(echo "$findings" | jq 'length')"

  if [[ "$count" -eq 0 ]]; then
    repo_line "${DIM}No findings — no specs to generate${NC}"
    echo "0"
    return 0
  fi

  # Group findings
  local groups
  groups="$(spec_group_findings "$findings")"
  local num_groups
  num_groups="$(echo "$groups" | jq 'length')"

  # Cap at max specs per repo
  if [[ "$num_groups" -gt "$MAX_SPECS_PER_REPO" ]]; then
    repo_line "${SYM_WARN} Capping at ${MAX_SPECS_PER_REPO} specs (${num_groups} groups found)"
    groups="$(echo "$groups" | jq --argjson max "$MAX_SPECS_PER_REPO" '.[:$max]')"
    num_groups="$MAX_SPECS_PER_REPO"
  fi

  local specs_created=0
  local next_id_num
  next_id_num="$(spec_next_id "$repo_dir" | grep -oP '[0-9]+')"

  for i in $(seq 0 $((num_groups - 1))); do
    local group
    group="$(echo "$groups" | jq ".[$i]")"
    local spec_id
    spec_id="$(printf "FEAT-%04d" $((next_id_num + i)))"

    spec_generate "$repo_dir" "$repo_name" "$spec_id" "$group" || {
      log_warn "Failed to generate spec ${spec_id} for ${repo_name}"
      continue
    }
    specs_created=$((specs_created + 1))
  done

  echo "$specs_created"
}
