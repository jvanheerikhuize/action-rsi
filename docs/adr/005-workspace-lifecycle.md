# ADR-005: Workspace Lifecycle and Failure Recovery

**Status:** Accepted
**Date:** 2026-04-02

## Context

The RSI pipeline creates temporary workspaces for cloning and analyzing repos. Failures can leave workspaces in an inconsistent state, and the pipeline has no mechanism to resume interrupted audits.

## Decision

### Workspace Lifecycle

1. **Creation** — `config_load()` creates a temp directory via `mktemp -d /tmp/rsi-workspace.XXXXXX` with `chmod 700` (restricted permissions because git remotes contain PAT tokens)
2. **Usage** — Each repo is cloned into `$WORKSPACE/<repo-name>/` as a shallow clone (`--depth 1`)
3. **Cleanup** — `config_cleanup()` runs via `trap EXIT`, deleting the entire workspace regardless of success or failure

### Failure Handling

- **Per-repo isolation**: Each repo is processed independently. If one fails, the pipeline continues to the next.
- **No resume**: Interrupted runs cannot be resumed. The entire pipeline re-runs from scratch. This is acceptable because a full audit of 2 repos takes ~60 seconds.
- **Budget protection**: `cost_check_budget()` runs before each repo. If the budget is exceeded, remaining repos are skipped (not failed).
- **Git push retry**: The PR manager retries push operations 3 times with exponential backoff to handle transient failures.

### Recovery from Partial Failures

| Scenario | What happens | Recovery |
|----------|-------------|----------|
| API key invalid | Pipeline fails at config validation | Fix the secret in repo settings |
| Clone fails | Repo is skipped, counter incremented | Check PAT permissions |
| LLM call fails | Repo is skipped after 5 retries | Check API key, rate limits |
| Push fails | PR not created, audit still logged | Check PAT write access |
| Budget exceeded | Remaining repos skipped gracefully | Increase budget_usd |
| Pipeline killed mid-run | Workspace cleaned up by OS (/tmp) | Re-trigger manually |

## Consequences

- Simple, stateless design — no database, no checkpoint files
- Trade-off: re-runs repeat work. Acceptable at current scale (~$0.06/repo)
- Temp workspace in /tmp means OS cleans up even if trap fails
