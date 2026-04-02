#!/usr/bin/env bash
# discovery.sh — GitHub API: list repos, clone targets
set -euo pipefail

GITHUB_API="https://api.github.com"

# Fetch all repos for the configured user
# Populates the global ALL_REPOS array
discovery_fetch_repos() {
  log_step "Discovering repos for ${GITHUB_USERNAME}..."

  local page=1
  local per_page=100
  ALL_REPOS=()

  while true; do
    local response
    response="$(curl -sf \
      -H "Authorization: token ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "${GITHUB_API}/users/${GITHUB_USERNAME}/repos?per_page=${per_page}&page=${page}&type=owner&sort=updated")" || {
      log_error "Failed to fetch repos (page $page)"
      return 1
    }

    local count
    count="$(echo "$response" | jq 'length')"
    if [[ "$count" -eq 0 ]]; then
      break
    fi

    # Extract repo names (skip archived and forks)
    while IFS= read -r name; do
      ALL_REPOS+=("$name")
    done < <(echo "$response" | jq -r '.[] | select(.archived == false and .fork == false) | .name')

    if [[ "$count" -lt "$per_page" ]]; then
      break
    fi
    page=$((page + 1))
  done

  REPOS_DISCOVERED=${#ALL_REPOS[@]}
  log_info "Discovered $REPOS_DISCOVERED repos"
}

# Filter repos based on test mode, exclusions, etc.
# Populates the global TARGET_REPOS array
discovery_filter_repos() {
  TARGET_REPOS=()

  for repo in "${ALL_REPOS[@]}"; do
    # Skip excluded repos
    if in_array "$repo" "${EXCLUDE_REPOS[@]+"${EXCLUDE_REPOS[@]}"}"; then
      log_info "Skipping excluded repo: $repo"
      continue
    fi

    # In test mode, only include test repos
    if [[ "$TEST_MODE" == "true" ]]; then
      if ! in_array "$repo" "${TEST_REPOS[@]}"; then
        continue
      fi
    fi

    TARGET_REPOS+=("$repo")
  done

  log_info "Target repos (${#TARGET_REPOS[@]}): ${TARGET_REPOS[*]}"
}

# Clone a repo into the workspace
# Usage: discovery_clone_repo <repo_name>
# Sets REPO_DIR to the cloned directory
discovery_clone_repo() {
  local repo="$1"
  REPO_DIR="${WORKSPACE}/${repo}"

  if [[ -d "$REPO_DIR" ]]; then
    log_info "Repo already cloned: $repo"
    return 0
  fi

  log_info "Cloning ${GITHUB_USERNAME}/${repo}..."
  retry 3 2 git clone --depth 1 --single-branch \
    "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_USERNAME}/${repo}.git" \
    "$REPO_DIR" 2>/dev/null || {
    log_error "Failed to clone ${repo}"
    return 1
  }
}

# Build a lightweight summary of a repo for cross-reference context
# Usage: discovery_repo_summary <repo_dir> <repo_name>
# Outputs a JSON summary
discovery_repo_summary() {
  local repo_dir="$1"
  local repo_name="$2"

  local readme_excerpt=""
  if [[ -f "${repo_dir}/README.md" ]]; then
    readme_excerpt="$(head -100 "${repo_dir}/README.md" | tr '\n' ' ' | cut -c1-500)"
  fi

  local structure
  structure="$(find "$repo_dir" -maxdepth 2 -not -path '*/.git/*' -not -name '.git' | head -50 | sed "s|${repo_dir}/||" | sort)"

  local languages
  languages="$(find "$repo_dir" -maxdepth 3 -type f -not -path '*/.git/*' \
    \( -name '*.sh' -o -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.yaml' -o -name '*.yml' \
       -o -name '*.json' -o -name '*.html' -o -name '*.css' -o -name '*.go' -o -name '*.rs' \) \
    2>/dev/null | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -5 | awk '{print $2}' | paste -sd ',' -)"

  local has_ci="false"
  [[ -d "${repo_dir}/.github/workflows" ]] && has_ci="true"

  local has_specs="false"
  [[ -d "${repo_dir}/specs" ]] && has_specs="true"

  local has_tests="false"
  [[ -d "${repo_dir}/tests" ]] || [[ -d "${repo_dir}/test" ]] && has_tests="true"

  jq -nc \
    --arg name "$repo_name" \
    --arg readme "$readme_excerpt" \
    --arg structure "$structure" \
    --arg languages "$languages" \
    --argjson has_ci "$has_ci" \
    --argjson has_specs "$has_specs" \
    --argjson has_tests "$has_tests" \
    '{
      name: $name,
      languages: $languages,
      has_ci: $has_ci,
      has_specs: $has_specs,
      has_tests: $has_tests,
      structure: $structure,
      readme_excerpt: $readme
    }'
}
