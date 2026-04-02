# ADR-001: Three-Layer Audit Architecture

**Status:** Accepted
**Date:** 2026-04-02

## Context

The original RSI design (v0) used multiple Claude API calls per repo — one per audit dimension (functional, non-functional, documentation, feature ideas, cross-references, web insights). Each call used tool-use loops (file reading, web search), resulting in 10-50 API round trips per repo at ~$0.50-1.00 per repo.

With 19 repos and 6 dimensions, a full audit cost $10-15 and took over an hour.

## Decision

Restructure into three layers:

1. **Static Analysis (free)** — ShellCheck, grep-based security patterns, gitleaks, trivy. Catches 80%+ of code quality and security findings at zero cost.
2. **Context Builder (free)** — Pre-selects key files, builds file structure, pre-fetches web search results, assembles a single JSON context bundle (~10K tokens per repo).
3. **Single-Shot LLM (one API call)** — One Claude API call per repo with the full context bundle. Covers all dimensions in a single response. No tools defined — everything the LLM needs is in the prompt.

## Consequences

- **Cost:** ~$0.05-0.10 per repo (down from ~$0.50-1.00). A full 19-repo audit costs ~$1-2 instead of $10-15.
- **Speed:** ~30s per repo instead of 5-10 minutes. No tool-use round trips.
- **Reliability:** No tool-use failures, no max-rounds exhaustion, no JSON-in-markdown parsing issues.
- **Trade-off:** The LLM can't explore files on demand. It only sees the 5 key files selected by the context builder. Deep file-level analysis depends on static tools.
