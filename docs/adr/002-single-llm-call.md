# ADR-002: Single LLM Call Per Repo (No Tool Use)

**Status:** Accepted
**Date:** 2026-04-02

## Context

The original design gave Claude tools (`read_file`, `list_directory`, `search_files`, `web_search`) and let it explore repos autonomously. This was elegant but caused problems:

- Tool-use loops consumed 10-50 API round trips per dimension
- Max tool rounds (10-15) were frequently exhausted
- Claude sometimes returned `{"error": "max tool rounds reached"}` instead of findings
- Each round trip added latency and cost
- JSON responses wrapped in markdown fences broke parsing

## Decision

Remove all tool definitions. Pre-load everything the LLM needs into a single context bundle (key files, file structure, static analysis results, web search results) and make one API call with no tools.

## Consequences

- **Deterministic cost:** Exactly 1 API call per repo. Cost is predictable from context size.
- **No failure modes:** No tool-use loops to exhaust, no intermediate parsing.
- **Prompt caching:** The system prompt stays identical across repos, enabling Claude's prompt caching to reduce input costs on subsequent repos.
- **Trade-off:** The LLM cannot request additional files. The context builder must select the right files upfront. For most repos, 5 key files + static analysis covers the important code paths.
