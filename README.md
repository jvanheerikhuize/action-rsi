# RSI — Recursive Self-Improvement

AI-powered audit system that periodically reviews all repositories for quality, security, documentation, and improvement opportunities — then generates actionable spec files following the [A-SDLC](https://github.com/jvanheerikhuize/a-sdlc) governance framework.

## What it does

A GitHub Action runs on a configurable schedule and uses the Claude API to audit repositories across five dimensions:

| Dimension | Focus |
|-----------|-------|
| **Functional** | Code quality, bugs, test coverage gaps |
| **Non-functional** | Security, performance, maintainability |
| **Feature ideas** | New capabilities based on repo purpose and tech stack |
| **Documentation** | README completeness, inline docs, missing guides |
| **Cross-references** | Shared patterns, dependency alignment, ecosystem drift |

For each finding, the system generates A-SDLC feature spec files (YAML) and opens a pull request in the target repository. Web research on industry best practices is logged for traceability.

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐     ┌───────────┐
│  Cron/Manual │────▶│  Discover &  │────▶│  Claude API    │────▶│  Generate │
│  Trigger     │     │  Clone Repos │     │  Audit Agent   │     │  Specs    │
└─────────────┘     └──────────────┘     │  + Web Search  │     └─────┬─────┘
                                          └────────────────┘           │
                                                                       ▼
                                          ┌────────────────┐     ┌───────────┐
                                          │  Research Logs │◀────│  Open PRs │
                                          │  (JSONL)       │     │  per Repo │
                                          └────────────────┘     └───────────┘
```

## Quick start

### Prerequisites

- Python 3.11+
- [Anthropic API key](https://console.anthropic.com/)
- GitHub PAT with `repo` scope

### Local run

```bash
pip install .
export ANTHROPIC_API_KEY="sk-ant-..."
export RSI_GITHUB_TOKEN="ghp_..."
python -m src.main
```

### GitHub Actions

The workflow runs automatically on the configured schedule. Set these repository secrets:

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `RSI_GITHUB_TOKEN` | GitHub PAT with repo scope |

## Configuration

Edit `rsi.config.yaml`:

```yaml
github_username: jvanheerikhuize
test_mode: true                    # audit only test_repos
test_repos: [dotfiles, a-sdlc]
budget_usd: 10
model: claude-sonnet-4-20250514
max_specs_per_repo: 5
schedule: "0 6 * * 1"             # Monday 06:00 UTC
```

## Project structure

```
rsi/
├── .github/workflows/rsi-audit.yml   # Scheduled GitHub Action
├── src/                               # Python source
│   ├── main.py                        # Entrypoint
│   ├── config.py                      # Configuration loader
│   ├── discovery.py                   # GitHub API (repos, cloning, PRs)
│   ├── agent.py                       # Claude API client with tool use
│   ├── auditor.py                     # Audit orchestrator
│   ├── dimensions/                    # Five audit dimension modules
│   ├── spec_generator.py             # YAML spec file generator
│   ├── research_logger.py            # JSONL research log writer
│   ├── pr_manager.py                 # PR creation and management
│   └── cost_tracker.py               # API cost budget enforcement
├── templates/                         # Jinja2 spec templates
├── logs/research/                     # Web research logs (JSONL)
├── specs/features/                    # This project's own specs
├── rsi.config.yaml                    # Audit configuration
└── pyproject.toml                     # Python project config
```

## License

[MIT](LICENSE)
