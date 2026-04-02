#!/usr/bin/env bash
# static_analysis.sh — Layer 1: Free static analysis (zero LLM cost)
# Runs ShellCheck, security patterns, gitleaks, trivy on a repo
# Outputs unified JSON findings to stdout
set -euo pipefail

# Check which tools are available (graceful degradation)
_sa_has_shellcheck() { command -v shellcheck &>/dev/null; }
_sa_has_gitleaks()   { command -v gitleaks &>/dev/null; }
_sa_has_trivy()      { command -v trivy &>/dev/null; }

# Install tools if missing (for CI environments)
sa_install_tools() {
  local bin_dir="${1:-/usr/local/bin}"

  if ! _sa_has_shellcheck; then
    log_info "Installing ShellCheck..."
    local tmp; tmp="$(mktemp -d)"
    curl -sL "https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck-v0.10.0.linux.x86_64.tar.xz" \
      | tar xJ -C "$tmp"
    cp "${tmp}/shellcheck-v0.10.0/shellcheck" "$bin_dir/"
    chmod +x "${bin_dir}/shellcheck"
    rm -rf "$tmp"
  fi

  if ! _sa_has_gitleaks; then
    log_info "Installing gitleaks..."
    curl -sL "https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz" \
      | tar xz -C "$bin_dir" gitleaks
    chmod +x "${bin_dir}/gitleaks"
  fi

  if ! _sa_has_trivy; then
    log_info "Installing trivy..."
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
      | sh -s -- -b "$bin_dir" 2>/dev/null
  fi
}

# ── ShellCheck ───────────────────────────────────────────────────────
# Run shellcheck on all .sh files, output as JSON findings
_sa_run_shellcheck() {
  local repo_dir="$1"
  local findings="[]"

  if ! _sa_has_shellcheck; then
    log_warn "ShellCheck not available — skipping"
    echo "[]"
    return 0
  fi

  local shell_files=()
  while IFS= read -r f; do
    shell_files+=("$f")
  done < <(find "$repo_dir" -name '*.sh' -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null || true)

  if [[ ${#shell_files[@]} -eq 0 ]]; then
    echo "[]"
    return 0
  fi

  local sc_output
  sc_output="$(shellcheck -f json "${shell_files[@]}" 2>/dev/null)" || true

  if [[ -z "$sc_output" || "$sc_output" == "[]" ]]; then
    echo "[]"
    return 0
  fi

  # Convert shellcheck JSON to unified findings format
  echo "$sc_output" | jq --arg repo_dir "$repo_dir" '
    [.[] | {
      source: "shellcheck",
      severity: (if .level == "error" then "high"
                 elif .level == "warning" then "medium"
                 else "low" end),
      category: "code_quality",
      code: ("SC" + (.code | tostring)),
      title: .message,
      description: .message,
      file: (.file | sub($repo_dir + "/"; "")),
      line: .line,
      column: .column,
      end_line: .endLine,
      end_column: .endColumn,
      fix: (.fix // null)
    }]
  '
}

# ── Security Pattern Scanner (bash-native SAST) ─────────────────────
# Grep-based security scanning for common vulnerabilities
_sa_run_security_scan() {
  local repo_dir="$1"
  local findings="[]"

  # Patterns: command injection, eval, unsafe temp files, hardcoded secrets
  local -A patterns=(
    ["eval_usage"]='eval\s'
    ["unsafe_temp"]='mktemp\s+-t\b|/tmp/[a-zA-Z]'
    ["curl_insecure"]='curl\s.*-k\b|curl\s.*--insecure'
    ["shell_injection"]='`\$\(|"\$\{.*\}".*\|'
    ["hardcoded_password"]='password\s*=\s*["\x27][^"\x27]+'
    ["chmod_777"]='chmod\s+777'
    ["sudo_nopasswd"]='NOPASSWD'
    ["http_not_https"]='http://[^l][^o][^c]'
  )

  local -A pattern_titles=(
    ["eval_usage"]="Use of eval (potential code injection)"
    ["unsafe_temp"]="Predictable temp file path"
    ["curl_insecure"]="curl with disabled SSL verification"
    ["shell_injection"]="Potential shell injection via variable expansion"
    ["hardcoded_password"]="Possible hardcoded password"
    ["chmod_777"]="World-writable permissions (chmod 777)"
    ["sudo_nopasswd"]="NOPASSWD in sudo configuration"
    ["http_not_https"]="HTTP URL (not HTTPS)"
  )

  for pattern_name in "${!patterns[@]}"; do
    local pattern="${patterns[$pattern_name]}"
    local title="${pattern_titles[$pattern_name]}"

    local matches
    matches="$(grep -rn --include='*.sh' --include='*.yaml' --include='*.yml' --include='*.conf' \
      -E "$pattern" "$repo_dir" 2>/dev/null \
      | grep -v '/.git/' | head -20)" || continue

    while IFS= read -r match; do
      [[ -z "$match" ]] && continue
      local file line_num content
      file="$(echo "$match" | cut -d: -f1 | sed "s|${repo_dir}/||")"
      line_num="$(echo "$match" | cut -d: -f2)"
      content="$(echo "$match" | cut -d: -f3-)"

      findings="$(echo "$findings" | jq \
        --arg title "$title" \
        --arg file "$file" \
        --argjson line "$line_num" \
        --arg content "$content" \
        --arg code "$pattern_name" \
        '. + [{
          source: "security_scan",
          severity: "medium",
          category: "security",
          code: $code,
          title: $title,
          description: ("Found at " + $file + ":" + ($line | tostring) + ": " + $content),
          file: $file,
          line: $line,
          column: 1,
          end_line: $line,
          end_column: 1,
          fix: null
        }]')"
    done <<< "$matches"
  done

  echo "$findings"
}

# ── Gitleaks (secrets detection) ─────────────────────────────────────
_sa_run_gitleaks() {
  local repo_dir="$1"

  if ! _sa_has_gitleaks; then
    log_warn "gitleaks not available — skipping"
    echo "[]"
    return 0
  fi

  local gl_output
  gl_output="$(gitleaks detect --source "$repo_dir" --no-git -f json 2>/dev/null)" || true

  if [[ -z "$gl_output" || "$gl_output" == "null" ]]; then
    echo "[]"
    return 0
  fi

  echo "$gl_output" | jq --arg repo_dir "$repo_dir" '
    [.[]? | {
      source: "gitleaks",
      severity: "high",
      category: "secrets",
      code: .RuleID,
      title: ("Leaked secret: " + .Description),
      description: ("Found " + .Description + " in " + .File + " at line " + (.StartLine | tostring)),
      file: .File,
      line: .StartLine,
      column: .StartColumn,
      end_line: .EndLine,
      end_column: .EndColumn,
      fix: null
    }]
  ' 2>/dev/null || echo "[]"
}

# ── Trivy (dependency vulnerabilities) ───────────────────────────────
_sa_run_trivy() {
  local repo_dir="$1"

  if ! _sa_has_trivy; then
    log_warn "trivy not available — skipping"
    echo "[]"
    return 0
  fi

  local trivy_output
  trivy_output="$(trivy fs --scanners vuln --format json --quiet "$repo_dir" 2>/dev/null)" || true

  if [[ -z "$trivy_output" ]]; then
    echo "[]"
    return 0
  fi

  echo "$trivy_output" | jq '
    [.Results[]? | .Vulnerabilities[]? | {
      source: "trivy",
      severity: (if .Severity == "CRITICAL" then "high"
                 elif .Severity == "HIGH" then "high"
                 elif .Severity == "MEDIUM" then "medium"
                 else "low" end),
      category: "vulnerability",
      code: .VulnerabilityID,
      title: (.Title // .VulnerabilityID),
      description: (.Description // "No description available"),
      file: (.PkgName // "unknown"),
      line: 0,
      column: 0,
      end_line: 0,
      end_column: 0,
      fix: (.FixedVersion // null)
    }]
  ' 2>/dev/null || echo "[]"
}

# ── Repo Metrics (complexity, structure) ─────────────────────────────
_sa_repo_metrics() {
  local repo_dir="$1"

  local total_files sh_files yaml_files total_lines
  total_files="$(find "$repo_dir" -type f -not -path '*/.git/*' 2>/dev/null | wc -l)"
  sh_files="$(find "$repo_dir" -name '*.sh' -not -path '*/.git/*' 2>/dev/null | wc -l)"
  yaml_files="$(find "$repo_dir" \( -name '*.yaml' -o -name '*.yml' \) -not -path '*/.git/*' 2>/dev/null | wc -l)"
  total_lines="$(find "$repo_dir" -name '*.sh' -not -path '*/.git/*' -exec cat {} + 2>/dev/null | wc -l)"

  # Count functions
  local function_count
  function_count="$(grep -rch '^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*()' "$repo_dir" --include='*.sh' 2>/dev/null | awk '{s+=$1} END {print s+0}')"

  # Largest files
  local largest_files
  largest_files="$(find "$repo_dir" -name '*.sh' -not -path '*/.git/*' -exec wc -l {} + 2>/dev/null \
    | sort -rn | head -6 | tail -5 | awk -v rd="$repo_dir/" '{gsub(rd, "", $2); print $2 ":" $1}' | paste -sd ',' -)" || true

  # Has tests?
  local has_tests="false"
  [[ -d "${repo_dir}/tests" || -d "${repo_dir}/test" ]] && has_tests="true"

  jq -nc \
    --argjson total_files "$total_files" \
    --argjson sh_files "$sh_files" \
    --argjson yaml_files "$yaml_files" \
    --argjson total_lines "$total_lines" \
    --argjson function_count "$function_count" \
    --arg largest_files "$largest_files" \
    --argjson has_tests "$has_tests" \
    '{
      total_files: $total_files,
      shell_files: $sh_files,
      yaml_files: $yaml_files,
      total_shell_lines: $total_lines,
      function_count: $function_count,
      largest_files: $largest_files,
      has_tests: $has_tests
    }'
}

# ── Main: Run all static analysis ────────────────────────────────────
# Usage: sa_run <repo_dir> <repo_name>
# Outputs unified JSON to stdout
sa_run() {
  local repo_dir="$1"
  local repo_name="$2"

  repo_line "${SYM_SEARCH} ${BOLD}Static Analysis${NC}"

  # Run each analyzer
  local sc_findings sec_findings gl_findings trivy_findings metrics

  tool_line "shellcheck"
  sc_findings="$(_sa_run_shellcheck "$repo_dir")"
  local sc_count; sc_count="$(echo "$sc_findings" | jq 'length')"

  tool_line "security patterns"
  sec_findings="$(_sa_run_security_scan "$repo_dir")"
  local sec_count; sec_count="$(echo "$sec_findings" | jq 'length')"

  tool_line "gitleaks"
  gl_findings="$(_sa_run_gitleaks "$repo_dir")"
  local gl_count; gl_count="$(echo "$gl_findings" | jq 'length')"

  tool_line "trivy"
  trivy_findings="$(_sa_run_trivy "$repo_dir")"
  local trivy_count; trivy_count="$(echo "$trivy_findings" | jq 'length')"

  tool_line "metrics"
  metrics="$(_sa_repo_metrics "$repo_dir")"

  # Merge all findings
  local all_findings
  all_findings="$(jq -nc \
    --argjson sc "$sc_findings" \
    --argjson sec "$sec_findings" \
    --argjson gl "$gl_findings" \
    --argjson trivy "$trivy_findings" \
    '$sc + $sec + $gl + $trivy')"

  local total; total="$(echo "$all_findings" | jq 'length')"

  # Summary counts by severity
  local high medium low
  high="$(echo "$all_findings" | jq '[.[] | select(.severity == "high")] | length')"
  medium="$(echo "$all_findings" | jq '[.[] | select(.severity == "medium")] | length')"
  low="$(echo "$all_findings" | jq '[.[] | select(.severity == "low")] | length')"

  if [[ "$total" -gt 0 ]]; then
    repo_line "  ${SYM_CHECK} ${GREEN}${total} findings${NC} ${DIM}(${high} high, ${medium} medium, ${low} low)${NC}"
  else
    repo_line "  ${DIM}clean — no findings${NC}"
  fi

  repo_line "  ${DIM}shellcheck: ${sc_count} | security: ${sec_count} | secrets: ${gl_count} | vulns: ${trivy_count}${NC}"

  # Output unified result
  jq -nc \
    --arg repo "$repo_name" \
    --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson findings "$all_findings" \
    --argjson metrics "$metrics" \
    '{
      repo: $repo,
      timestamp: $date,
      layer: "static_analysis",
      metrics: $metrics,
      total_findings: ($findings | length),
      findings_by_severity: {
        high: [$findings[] | select(.severity == "high")] | length,
        medium: [$findings[] | select(.severity == "medium")] | length,
        low: [$findings[] | select(.severity == "low")] | length
      },
      findings_by_source: {
        shellcheck: [$findings[] | select(.source == "shellcheck")] | length,
        security_scan: [$findings[] | select(.source == "security_scan")] | length,
        gitleaks: [$findings[] | select(.source == "gitleaks")] | length,
        trivy: [$findings[] | select(.source == "trivy")] | length
      },
      findings: $findings
    }'
}
