# ADR-003: Context Size Limits

**Status:** Accepted
**Date:** 2026-04-02

## Context

Claude's context window is large (200K tokens) but input cost scales linearly. Sending entire repositories would be wasteful and expensive. We need to balance comprehensiveness with cost.

## Decision

Set these limits for context building:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `CTX_MAX_CHARS` | 80,000 (~20K tokens) | Keeps input under $0.06 per repo at Sonnet pricing |
| `CTX_MAX_FILES` | 5 | README + entry point + config + 2 largest source files |
| `CTX_MAX_FILE_CHARS` | 8,000 (~2K tokens) | Enough for most files; large files get truncated |

File selection priority:
1. README (always)
2. Main entry points (main.sh, index.js, app.py, etc.)
3. Config files (*.yaml, *.toml, *.json)
4. Largest source files by line count (fill remaining slots)

## Consequences

- **~10K tokens per repo** in practice, well under the 20K budget
- Total cost per repo: ~$0.03 input + ~$0.02 output = ~$0.05
- Large files are truncated with a `[... truncated, N bytes total]` marker
- The LLM is told the full file structure so it can reference files it hasn't seen
