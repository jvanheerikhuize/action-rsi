#!/usr/bin/env bash
# context_builder.sh — Layer 2: Smart context pre-loading
# Builds a single context bundle per repo for the LLM (no tool use needed)
set -euo pipefail

# Max tokens budget for context (approximate: 1 token ~ 4 chars)
CTX_MAX_CHARS="${CTX_MAX_CHARS:-80000}"  # ~20K tokens
CTX_MAX_FILES=5
CTX_MAX_FILE_CHARS=8000  # ~2K tokens per file

# ── Select key files ─────────────────────────────────────────────────
# Picks the most important files to include in context
_ctx_select_key_files() {
  local repo_dir="$1"
  local selected=()

  # Always include README if present
  for readme in README.md README.rst README.txt README; do
    if [[ -f "${repo_dir}/${readme}" ]]; then
      selected+=("$readme")
      break
    fi
  done

  # Include main entry points
  for entry in main.sh index.js index.ts app.py setup.py Makefile Dockerfile; do
    if [[ -f "${repo_dir}/${entry}" ]]; then
      selected+=("$entry")
    fi
    # Also check src/
    if [[ -f "${repo_dir}/src/${entry}" ]]; then
      selected+=("src/${entry}")
    fi
  done

  # Include config files
  for cfg in *.yaml *.yml *.toml *.json; do
    local matches
    matches="$(find "$repo_dir" -maxdepth 1 -name "$cfg" -not -name 'package-lock.json' -not -name 'yarn.lock' 2>/dev/null | head -2)" || true
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      selected+=("$(basename "$f")")
    done <<< "$matches"
  done

  # Fill remaining slots with largest source files
  local remaining=$((CTX_MAX_FILES - ${#selected[@]}))
  if [[ "$remaining" -gt 0 ]]; then
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      local rel="${f#${repo_dir}/}"
      # Skip if already selected
      local skip=false
      for s in "${selected[@]}"; do
        [[ "$s" == "$rel" ]] && skip=true
      done
      [[ "$skip" == true ]] && continue
      selected+=("$rel")
      remaining=$((remaining - 1))
      [[ "$remaining" -le 0 ]] && break
    done < <(find "$repo_dir" -type f \
      \( -name '*.sh' -o -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.go' -o -name '*.rs' \) \
      -not -path '*/.git/*' -not -path '*/node_modules/*' \
      -exec wc -l {} + 2>/dev/null | sort -rn | tail -n +2 | head -10 | awk '{print $2}')
  fi

  # Deduplicate and limit
  printf '%s\n' "${selected[@]}" | awk '!seen[$0]++' | head -"$CTX_MAX_FILES"
}

# ── Read file with truncation ────────────────────────────────────────
_ctx_read_file() {
  local file="$1"
  local max_chars="${2:-$CTX_MAX_FILE_CHARS}"

  if [[ ! -f "$file" ]]; then
    echo "[file not found]"
    return 0
  fi

  local content
  content="$(head -c "$max_chars" "$file" 2>/dev/null)" || content=""

  local full_size
  full_size="$(wc -c < "$file" 2>/dev/null)" || full_size=0

  if [[ "$full_size" -gt "$max_chars" ]]; then
    echo "${content}

[... truncated, ${full_size} bytes total]"
  else
    echo "$content"
  fi
}

# ── File structure ───────────────────────────────────────────────────
_ctx_file_structure() {
  local repo_dir="$1"
  find "$repo_dir" -maxdepth 3 -not -path '*/.git/*' -not -path '*/node_modules/*' \
    2>/dev/null | sed "s|${repo_dir}/||" | sort | head -80 || true
}

# ── Git diff since last audit ────────────────────────────────────────
_ctx_git_diff() {
  local repo_dir="$1"
  local since_date="${2:-}"

  if [[ -z "$since_date" ]]; then
    echo "[no previous audit — full scan]"
    return 0
  fi

  local diff
  diff="$(cd "$repo_dir" && git log --oneline --since="$since_date" 2>/dev/null)" || diff=""

  if [[ -z "$diff" ]]; then
    echo "[no changes since ${since_date}]"
  else
    local commit_count
    commit_count="$(echo "$diff" | wc -l)"
    local changed_files
    changed_files="$(cd "$repo_dir" && git diff --name-only "HEAD@{${since_date}}" HEAD 2>/dev/null | head -30)" || changed_files=""
    echo "Commits since ${since_date}: ${commit_count}
Changed files:
${changed_files}"
  fi
}

# ── Pre-fetch web search results ─────────────────────────────────────
_ctx_web_search() {
  local query="$1"
  local results="[]"

  # Try DuckDuckGo HTML (simple, no API key needed)
  local encoded_query
  encoded_query="$(printf '%s' "$query" | jq -sRr @uri)"

  local html
  html="$(curl -sf --max-time 8 \
    -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" \
    "https://html.duckduckgo.com/html/?q=${encoded_query}" 2>/dev/null)" || {
    echo "[]"
    return 0
  }

  # Parse titles and URLs from DDG HTML
  results="$(echo "$html" | awk '
    BEGIN { print "["; first=1; count=0 }
    /<a rel="nofollow" class="result__a"/ {
      if (count >= 5) exit
      match($0, /href="([^"]*)"/, href)
      match($0, />([^<]+)<\/a>/, title)
      if (href[1] != "" && title[1] != "") {
        url = href[1]
        if (url ~ /uddg=/) {
          match(url, /uddg=([^&]*)/, decoded)
          url = decoded[1]
        }
        gsub(/%2F/, "/", url)
        gsub(/%3A/, ":", url)
        gsub(/"/, "\\\"", title[1])
        if (!first) print ","
        first = 0
        printf "{\"url\":\"%s\",\"title\":\"%s\"}", url, title[1]
        count++
      }
    }
    END { print "]" }
  ' 2>/dev/null)" || results="[]"

  # Validate JSON
  echo "$results" | jq '.' 2>/dev/null || echo "[]"
}

# ── Main: Build context bundle ───────────────────────────────────────
# Usage: ctx_build <repo_dir> <repo_name> <static_findings_json> [last_audit_date]
# Outputs context bundle JSON to stdout
ctx_build() {
  local repo_dir="$1"
  local repo_name="$2"
  local static_findings="$3"
  local last_audit_date="${4:-}"

  repo_line "${SYM_SEARCH} ${BOLD}Context Builder${NC}"

  # 1. Select and read key files
  tool_line "selecting key files"
  local key_files_json="[]"
  while IFS= read -r rel_path; do
    [[ -z "$rel_path" ]] && continue
    local content
    content="$(_ctx_read_file "${repo_dir}/${rel_path}")"
    key_files_json="$(echo "$key_files_json" | jq \
      --arg path "$rel_path" \
      --arg content "$content" \
      '. + [{path: $path, content: $content}]')"
    tool_line "  ${rel_path}"
  done < <(_ctx_select_key_files "$repo_dir")

  # 2. File structure
  tool_line "file structure"
  local structure
  structure="$(_ctx_file_structure "$repo_dir")"

  # 3. Git diff (incremental)
  tool_line "change detection"
  local git_diff
  git_diff="$(_ctx_git_diff "$repo_dir" "$last_audit_date")"

  # 4. Static analysis summary (from Layer 1)
  local static_summary
  static_summary="$(echo "$static_findings" | jq '{
    total: .total_findings,
    by_severity: .findings_by_severity,
    by_source: .findings_by_source,
    top_findings: [.findings[:15][] | {source, severity, code, title, file, line}]
  }')"

  # 5. Pre-fetch web search results (for web insights dimension)
  local web_results="[]"
  if [[ " ${DIMENSIONS[*]:-} " == *" web_insights "* ]] || [[ "${RSI_DIMENSIONS:-all}" == "all" ]]; then
    tool_line "web search (pre-fetch)"
    # Determine repo tech stack from metrics
    local languages
    languages="$(echo "$static_findings" | jq -r '.metrics.largest_files // ""')"
    local readme_excerpt
    readme_excerpt="$(echo "$key_files_json" | jq -r '.[0].content // ""' | head -5 | tr '\n' ' ' | cut -c1-200)"

    # Run 3 targeted searches
    local q1="best practices $(echo "$readme_excerpt" | cut -c1-60) 2025 2026"
    local q2="bash shell scripting security automation best practices 2026"
    local q3="open source tools similar to ${repo_name} alternatives 2026"

    local r1 r2 r3
    r1="$(_ctx_web_search "$q1")"
    r2="$(_ctx_web_search "$q2")"
    r3="$(_ctx_web_search "$q3")"

    web_results="$(jq -nc \
      --arg q1 "$q1" --argjson r1 "$r1" \
      --arg q2 "$q2" --argjson r2 "$r2" \
      --arg q3 "$q3" --argjson r3 "$r3" \
      '[
        {query: $q1, results: $r1},
        {query: $q2, results: $r2},
        {query: $q3, results: $r3}
      ]')"
    local total_results
    total_results="$(echo "$web_results" | jq '[.[].results | length] | add')"
    tool_line "  ${total_results} results from 3 queries"
  fi

  # 6. Repo summary from discovery (if available)
  local repo_summary="{}"
  local summary_file="${WORKSPACE}/.summaries/${repo_name}.json"
  if [[ -f "$summary_file" ]]; then
    repo_summary="$(cat "$summary_file")"
  fi

  # Assemble the context bundle
  local bundle
  bundle="$(jq -nc \
    --arg repo "$repo_name" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson key_files "$key_files_json" \
    --arg structure "$structure" \
    --arg git_diff "$git_diff" \
    --argjson static_analysis "$static_summary" \
    --argjson web_research "$web_results" \
    --argjson repo_summary "$repo_summary" \
    '{
      repo: $repo,
      timestamp: $date,
      layer: "context_bundle",
      repo_summary: $repo_summary,
      file_structure: $structure,
      key_files: $key_files,
      change_history: $git_diff,
      static_analysis: $static_analysis,
      web_research: $web_research
    }')"

  # Report context size
  local bundle_chars
  bundle_chars="$(echo "$bundle" | wc -c)"
  local approx_tokens=$((bundle_chars / 4))
  repo_line "  ${SYM_CHECK} Context: ~${approx_tokens} tokens ${DIM}(${#key_files_json} files, $(echo "$web_results" | jq 'length') searches)${NC}"

  echo "$bundle"
}
