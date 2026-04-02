#!/usr/bin/env bash
# agent.sh — Claude API client with tool-use loop via curl + jq
set -euo pipefail

CLAUDE_API="https://api.anthropic.com/v1/messages"
CLAUDE_VERSION="2023-06-01"
MAX_TOOL_ROUNDS=10

# Tool definitions for the audit agent
TOOL_DEFINITIONS='[
  {
    "name": "read_file",
    "description": "Read the contents of a file from the repository being audited. Returns the file content as text. Use this to inspect source code, configuration, documentation, etc.",
    "input_schema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path to the file within the repository (e.g., src/main.sh, README.md)"
        }
      },
      "required": ["path"]
    }
  },
  {
    "name": "list_directory",
    "description": "List files and directories at the given path in the repository. Returns a listing with file types and sizes.",
    "input_schema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path to the directory (use . for repo root)"
        }
      },
      "required": ["path"]
    }
  },
  {
    "name": "search_files",
    "description": "Search for a pattern in repository files using grep. Returns matching lines with file paths and line numbers.",
    "input_schema": {
      "type": "object",
      "properties": {
        "pattern": {
          "type": "string",
          "description": "Grep-compatible regex pattern to search for"
        },
        "path": {
          "type": "string",
          "description": "Directory to search in (relative to repo root, default: .)"
        },
        "file_glob": {
          "type": "string",
          "description": "File glob pattern to filter (e.g., *.sh, *.yaml)"
        }
      },
      "required": ["pattern"]
    }
  },
  {
    "name": "web_search",
    "description": "Search the web for information about best practices, industry standards, library updates, and other relevant topics. Use this to research improvements and validate recommendations.",
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query (be specific, include technology names and year for recency)"
        }
      },
      "required": ["query"]
    }
  },
  {
    "name": "get_repo_summary",
    "description": "Get a pre-computed summary of another repository in the ecosystem. Useful for cross-referencing patterns, dependencies, and conventions across repos.",
    "input_schema": {
      "type": "object",
      "properties": {
        "repo_name": {
          "type": "string",
          "description": "Name of the repository to get the summary for"
        }
      },
      "required": ["repo_name"]
    }
  }
]'

# Execute a tool call locally
# Usage: agent_execute_tool <repo_dir> <tool_name> <tool_input_json>
# Outputs the tool result as a string
agent_execute_tool() {
  local repo_dir="$1"
  local tool_name="$2"
  local tool_input="$3"
  local result=""

  case "$tool_name" in
    read_file)
      local path
      path="$(echo "$tool_input" | jq -r '.path')"
      local full_path="${repo_dir}/${path}"
      if [[ -f "$full_path" ]]; then
        result="$(truncate_text "$(cat "$full_path")" 8000)"
      else
        result="Error: File not found: ${path}"
      fi
      ;;

    list_directory)
      local path
      path="$(echo "$tool_input" | jq -r '.path')"
      local full_path="${repo_dir}/${path}"
      if [[ -d "$full_path" ]]; then
        result="$(ls -la "$full_path" 2>&1 | head -50)"
      else
        result="Error: Directory not found: ${path}"
      fi
      ;;

    search_files)
      local pattern path file_glob
      pattern="$(echo "$tool_input" | jq -r '.pattern')"
      path="$(echo "$tool_input" | jq -r '.path // "."')"
      file_glob="$(echo "$tool_input" | jq -r '.file_glob // ""')"
      local full_path="${repo_dir}/${path}"

      local grep_args=(-rn --include='*' "$pattern" "$full_path")
      if [[ -n "$file_glob" ]]; then
        grep_args=(-rn --include="$file_glob" "$pattern" "$full_path")
      fi

      result="$(grep "${grep_args[@]}" 2>/dev/null | head -30 | sed "s|${repo_dir}/||g")" || result="No matches found"
      ;;

    web_search)
      local query
      query="$(echo "$tool_input" | jq -r '.query')"
      result="$(agent_web_search "$query")"
      ;;

    get_repo_summary)
      local repo_name
      repo_name="$(echo "$tool_input" | jq -r '.repo_name')"
      local summary_file="${WORKSPACE}/.summaries/${repo_name}.json"
      if [[ -f "$summary_file" ]]; then
        result="$(cat "$summary_file")"
      else
        result="Error: No summary available for repo: ${repo_name}"
      fi
      ;;

    *)
      result="Error: Unknown tool: ${tool_name}"
      ;;
  esac

  echo "$result"
}

# Default public SearXNG instance (override via SEARXNG_URL env var or rsi.config.yaml)
SEARXNG_DEFAULT_URL="https://search.ononoki.org"

# List of fallback public SearXNG instances
SEARXNG_FALLBACKS=(
  "https://search.ononoki.org"
  "https://searx.be"
  "https://search.sapti.me"
  "https://searxng.site"
)

# Perform a web search via SearXNG, with DuckDuckGo HTML fallback
agent_web_search() {
  local query="$1"
  local results="[]"

  local searxng_url="${SEARXNG_URL:-$SEARXNG_DEFAULT_URL}"

  # Try SearXNG (primary + fallbacks)
  local instances=("$searxng_url" "${SEARXNG_FALLBACKS[@]}")
  # Deduplicate
  local -A seen
  local unique_instances=()
  for inst in "${instances[@]}"; do
    if [[ -z "${seen[$inst]:-}" ]]; then
      seen[$inst]=1
      unique_instances+=("$inst")
    fi
  done

  for instance in "${unique_instances[@]}"; do
    local encoded_query
    encoded_query="$(printf '%s' "$query" | jq -sRr @uri)"
    local response
    response="$(curl -sf --max-time 10 \
      -H "Accept: application/json" \
      "${instance}/search?q=${encoded_query}&format=json&categories=general&language=en" 2>/dev/null)" || continue

    if [[ -n "$response" ]]; then
      results="$(echo "$response" | jq '[.results[:5] // [] | .[] | {url: .url, title: .title, excerpt: .content}]' 2>/dev/null)" || continue
      if [[ "$(echo "$results" | jq 'length')" -gt 0 ]]; then
        log_info "  Web search via SearXNG (${instance}): $(echo "$results" | jq 'length') results"
        echo "$results"
        return 0
      fi
    fi
  done

  # Fallback: DuckDuckGo HTML scraping
  log_warn "SearXNG unavailable — falling back to DuckDuckGo HTML scraping"
  results="$(agent_web_search_ddg "$query")"
  echo "$results"
}

# Fallback: scrape DuckDuckGo HTML search results
agent_web_search_ddg() {
  local query="$1"
  local encoded_query
  encoded_query="$(printf '%s' "$query" | jq -sRr @uri)"

  local html
  html="$(curl -sf --max-time 10 \
    -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" \
    "https://html.duckduckgo.com/html/?q=${encoded_query}" 2>/dev/null)" || {
    log_warn "DuckDuckGo fallback also failed"
    echo '[{"url":"","title":"Web search unavailable","excerpt":"All search backends failed. Audit will proceed using only repository analysis."}]'
    return 0
  }

  # Parse results from DDG HTML (extract titles, URLs, snippets)
  local results
  results="$(echo "$html" | awk '
    BEGIN { print "["; first=1; count=0 }
    /<a rel="nofollow" class="result__a"/ {
      if (count >= 5) exit
      # Extract href
      match($0, /href="([^"]*)"/, href)
      # Extract title text (between > and </a>)
      match($0, />([^<]+)<\/a>/, title)
      if (href[1] != "" && title[1] != "") {
        url = href[1]
        # Decode DDG redirect URL
        if (url ~ /uddg=/) {
          match(url, /uddg=([^&]*)/, decoded)
          url = decoded[1]
        }
        gsub(/%2F/, "/", url)
        gsub(/%3A/, ":", url)
        gsub(/%3D/, "=", url)
        gsub(/%3F/, "?", url)
        gsub(/%26/, "\\&", url)
        gsub(/"/, "\\\"", title[1])
        if (!first) print ","
        first = 0
        printf "{\"url\":\"%s\",\"title\":\"%s\",\"excerpt\":\"\"}", url, title[1]
        count++
      }
    }
    END { print "]" }
  ' 2>/dev/null)" || results="[]"

  # Validate JSON
  if ! echo "$results" | jq '.' > /dev/null 2>&1; then
    results='[{"url":"","title":"DuckDuckGo parse failed","excerpt":"Could not parse search results. Audit will proceed using only repository analysis."}]'
  fi

  local count
  count="$(echo "$results" | jq 'length' 2>/dev/null)" || count=0
  if [[ "$count" -gt 0 ]]; then
    log_info "  Web search via DuckDuckGo fallback: ${count} results"
  fi

  echo "$results"
}

# Send a message to Claude and handle the tool-use loop
# Usage: agent_chat <repo_dir> <repo_name> <system_prompt> <user_message>
# Outputs the final text response (should be structured JSON findings)
agent_chat() {
  local repo_dir="$1"
  local repo_name="$2"
  local system_prompt="$3"
  local user_message="$4"

  # Build initial messages array
  local messages
  messages="$(jq -nc --arg content "$user_message" '[{"role":"user","content":$content}]')"

  local round=0
  while [[ $round -lt $MAX_TOOL_ROUNDS ]]; do
    round=$((round + 1))

    # Build request body and write to temp file (avoids shell escaping issues)
    local request_file
    request_file="$(mktemp /tmp/rsi-request.XXXXXX)"
    jq -nc \
      --arg model "$MODEL" \
      --arg system "$system_prompt" \
      --argjson messages "$messages" \
      --argjson tools "$TOOL_DEFINITIONS" \
      '{
        model: $model,
        max_tokens: 4096,
        system: $system,
        messages: $messages,
        tools: $tools
      }' > "$request_file"

    # Call Claude API (use @file to avoid shell escaping issues with -d)
    local response
    response="$(retry 3 5 curl -sf \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${ANTHROPIC_API_KEY}" \
      -H "anthropic-version: ${CLAUDE_VERSION}" \
      -d "@${request_file}" \
      "$CLAUDE_API")" || {
      rm -f "$request_file"
      log_error "Claude API call failed for ${repo_name} (round $round)"
      echo '{"error":"API call failed"}'
      return 1
    }
    rm -f "$request_file"

    # Track costs
    local input_tokens output_tokens
    input_tokens="$(echo "$response" | jq -r '.usage.input_tokens // 0')"
    output_tokens="$(echo "$response" | jq -r '.usage.output_tokens // 0')"
    cost_record "$repo_name" "$input_tokens" "$output_tokens"
    research_log_agent_call "$repo_name" "${CURRENT_DIMENSION:-unknown}" "$input_tokens" "$output_tokens"

    # Check stop reason
    local stop_reason
    stop_reason="$(echo "$response" | jq -r '.stop_reason')"

    if [[ "$stop_reason" == "end_turn" ]]; then
      # Extract the text response
      echo "$response" | jq -r '.content[] | select(.type == "text") | .text'
      return 0
    fi

    if [[ "$stop_reason" == "tool_use" ]]; then
      # Process tool calls
      local assistant_content
      assistant_content="$(echo "$response" | jq '.content')"

      # Append assistant message
      messages="$(echo "$messages" | jq --argjson content "$assistant_content" \
        '. + [{"role":"assistant","content":$content}]')"

      # Execute each tool call and collect results
      local tool_results="[]"
      while IFS= read -r tool_call; do
        local tool_id tool_name tool_input
        tool_id="$(echo "$tool_call" | jq -r '.id')"
        tool_name="$(echo "$tool_call" | jq -r '.name')"
        tool_input="$(echo "$tool_call" | jq -r '.input | tostring')"

        log_info "  Tool call: ${tool_name} $(echo "$tool_input" | jq -r 'to_entries | map(.key + "=" + (.value | tostring)) | join(", ")' 2>/dev/null || echo "$tool_input")"

        local tool_result
        tool_result="$(agent_execute_tool "$repo_dir" "$tool_name" "$tool_input")"

        # Log web searches to research log
        if [[ "$tool_name" == "web_search" ]]; then
          local query
          query="$(echo "$tool_input" | jq -r '.query')"
          research_log "$repo_name" "${CURRENT_DIMENSION:-unknown}" "$query" "$(echo "$tool_result" | jq '.' 2>/dev/null || echo '[]')"
        fi

        tool_results="$(echo "$tool_results" | jq \
          --arg id "$tool_id" \
          --arg content "$tool_result" \
          '. + [{"type":"tool_result","tool_use_id":$id,"content":$content}]')"
      done < <(echo "$assistant_content" | jq -c '.[] | select(.type == "tool_use")')

      # Append tool results as user message
      messages="$(echo "$messages" | jq --argjson results "$tool_results" \
        '. + [{"role":"user","content":$results}]')"
    else
      # Unexpected stop reason
      log_warn "Unexpected stop_reason: $stop_reason"
      echo "$response" | jq -r '.content[] | select(.type == "text") | .text // "{\"error\":\"unexpected stop\"}"'
      return 0
    fi
  done

  log_warn "Max tool rounds ($MAX_TOOL_ROUNDS) reached for ${repo_name}"
  echo '{"error":"max tool rounds reached"}'
}
