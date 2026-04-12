# RSI — Recursive Self-Improvement

Composable GitHub Actions that audit repositories across security, quality, documentation, and innovation — and bootstrap persistent agent context (`.agents/CONTEXT.md` + `.agents/AGENTS.md`) so any local agent can work effectively in the repo.

Each finding becomes an [A-SDLC](https://github.com/jvanheerikhuize/a-sdlc) feature spec and lands in a pull request against the target repo.

## Architecture

Six composable sub-actions orchestrated by a matrix workflow that runs repos in parallel:

```
discover  →  ┬─ static-analysis ─ context-build ─ bootstrap? ─ llm-analyze ─ publish-results
             ├─ (same, repo B)
             └─ (same, repo C)
                             ↓
                         summarize
```

| Action | Purpose |
|---|---|
| `actions/discover` | Enumerate repos for a user/org with filters → matrix JSON |
| `actions/static-analysis` | shellcheck / gitleaks / trivy / ruff / eslint + declarative security patterns |
| `actions/context-build` | Read `.agents/CONTEXT.md`, compute delta, select dimension-relevant files |
| `actions/bootstrap` | First-audit only: scaffold `.agents/CONTEXT.md` + `AGENTS.md` in a separate PR |
| `actions/llm-analyze` | Parallel multi-pass LLM analysis (security / quality / documentation / innovation) |
| `actions/publish-results` | Emit specs / SARIF / annotations / JSON + open audit PR |

Supported providers (via `lib/llm/`): Anthropic, OpenAI, Google, Ollama.

## Persistent context + delta

On the first audit, RSI writes `.agents/CONTEXT.md` (tech stack, entry points, modules, conventions, dependency graph, known concerns) and `.agents/AGENTS.md` (instructions for local agents). On subsequent audits it reads the existing context, computes a git-log-based delta, and focuses the LLM on what changed — shrinking context over time while keeping a durable shared understanding between RSI and local agents.

## Multi-pass analysis

Each dimension gets its own pass with a reasoning-mode-appropriate system prompt:

| Pass | Mode | Focus |
|---|---|---|
| security | adversarial | auth, input handling, secrets, deps |
| quality | analytical | entry points, error handling, tests |
| documentation | empathetic | README, setup, config docs |
| innovation | creative | feature ideas, ecosystem alternatives |

Passes run in parallel; the persistent context is cached at the provider level so marginal cost per additional pass is mostly output tokens.

## Running it

Workflow: `.github/workflows/rsi-audit.yml` (weekly cron + `workflow_dispatch`).

Secrets required on this repo:

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` (or equivalent) | LLM provider API key |
| `RSI_GITHUB_TOKEN` | PAT with `repo` + `workflow` scope to clone targets and open PRs |

Dispatch inputs (all optional, sensible defaults):

- `username` — GitHub user/org whose repos to audit
- `test_mode` + `test_repos` — restrict to a comma-separated list
- `exclude_repos` — skip list
- `passes` — subset of `security,quality,documentation,innovation`
- `provider` / `model` — LLM backend
- `max_parallel` — matrix concurrency
- `force_full` — ignore persistent context staleness check
- `output_formats` — any of `spec,sarif,annotations,json`

## Development

```bash
npm install
npm run lint     # tsc --noEmit
npm run bundle   # ncc-bundle each action into actions/*/dist/
```

`dist/` bundles are committed so the actions run without a runtime install step.

## License

[MIT](LICENSE)
