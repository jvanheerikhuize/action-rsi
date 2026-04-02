# ADR-004: Web Search via DuckDuckGo HTML

**Status:** Accepted
**Date:** 2026-04-02

## Context

The audit benefits from web research (best practices, new tools, security advisories). Options considered:

1. **Brave Search API** — Requires API key, has rate limits
2. **SearXNG** — Self-hosted, reliable, but requires infrastructure
3. **DuckDuckGo HTML** — No API key, public endpoint, HTML parsing needed
4. **No web search** — Simpler but loses the "web insights" dimension

## Decision

Use DuckDuckGo's HTML search (`html.duckduckgo.com/html/`) as the default, with SearXNG as an optional override. Parse results with `grep` + `jq` (not AWK, which broke on special characters).

Three targeted queries per repo:
1. Best practices for the repo's domain (based on README excerpt)
2. Shell scripting / security best practices (generic)
3. Alternative tools similar to the repo

## Consequences

- **No API key required** — works out of the box
- **Free** — no search API costs
- **Fragile** — DDG HTML structure can change without notice
- **Rate limited** — public instances may throttle; SearXNG override available for reliability
- **Pre-fetched** — searches happen in Layer 2 (context builder), not during LLM calls
