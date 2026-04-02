# RSI — Recursive Self-Improvement

AI-powered audit system that periodically reviews all repositories for quality, security, documentation, and improvement opportunities — then generates actionable spec files following the [A-SDLC](https://github.com/jvanheerikhuize/a-sdlc) governance framework.

## What it does

Each audit dimension runs as its own GitHub Action on a staggered schedule — one per day — so you can manage costs per dimension and disable expensive ones independently.

| Dimension | Schedule | Focus |
|-----------|----------|-------|
| **Functional** | Monday | Code quality, bugs, test coverage gaps |
| **Non-functional** | Tuesday | Security, performance, maintainability |
| **Feature ideas** | Wednesday | New capabilities based on repo purpose and tech stack |
| **Documentation** | Thursday | README completeness, inline docs, missing guides |
| **Cross-references** | Friday | Shared patterns, dependency alignment, ecosystem drift |
| **Web insights** | Saturday | Emerging trends, new libraries, techniques, and advisories via web research |

Each dimension has its own $2 budget cap. You can also trigger any combination manually via the main workflow (comma-separated: `functional,documentation`).

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

- Bash 4.4+, curl, jq, yq, git
- [Anthropic API key](https://console.anthropic.com/)
- GitHub PAT with `repo` scope

### Local run

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export RSI_GITHUB_TOKEN="ghp_..."
bash src/main.sh
```

### GitHub Actions

The workflow runs automatically on the configured schedule. Set these repository secrets:

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `RSI_GITHUB_TOKEN` | GitHub PAT with repo scope |
| `SEARXNG_URL` | *(optional)* Self-hosted SearXNG instance URL |

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
├── src/                               # Bash source
│   ├── main.sh                        # Entrypoint
│   ├── config.sh                      # Configuration loader (yq)
│   ├── discovery.sh                   # GitHub API (repos, cloning, PRs)
│   ├── agent.sh                       # Claude API client with tool use (curl + jq)
│   ├── auditor.sh                     # Audit orchestrator
│   ├── dimensions/                    # Six audit dimension modules
│   ├── spec_generator.sh             # YAML spec file generator
│   ├── research_logger.sh            # JSONL research log writer
│   ├── pr_manager.sh                 # PR creation and management
│   └── cost_tracker.sh               # API cost budget enforcement
├── templates/                         # envsubst/yq spec templates
├── logs/research/                     # Web research logs (JSONL)
├── specs/features/                    # This project's own specs
└── rsi.config.yaml                    # Audit configuration
```

## Runbook: Pipeline Setup

Step-by-step guide to get the RSI audit pipeline running.

### Step 1: Create API Keys

**Anthropic API key:**
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Navigate to **API Keys** and create a new key
3. Copy the key (starts with `sk-ant-`)

**GitHub Personal Access Token:**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token** (fine-grained)
3. Set **Repository access** to "All repositories" (or select specific repos)
4. Under **Permissions → Repository permissions**, grant:
   - **Contents**: Read and write (clone repos, push branches)
   - **Pull requests**: Read and write (open PRs)
   - **Metadata**: Read-only (list repos)
5. Generate and copy the token

**SearXNG (optional, for better web research reliability):**

Web search works out of the box using public SearXNG instances (free, no key needed).
For better reliability, you can self-host your own SearXNG instance:
1. Follow the [SearXNG Docker guide](https://docs.searxng.org/admin/installation-docker.html)
2. Set the `SEARXNG_URL` env var or `searxng_url` in `rsi.config.yaml`

### Step 2: Configure Repository Secrets

In the `rsi` repo on GitHub:

1. Go to **Settings → Secrets and variables → Actions**
2. Add these **Repository secrets**:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `RSI_GITHUB_TOKEN` | Your GitHub PAT |
| `SEARXNG_URL` | *(optional)* Your self-hosted SearXNG URL |

### Step 3: Review Configuration

Edit `rsi.config.yaml` to match your needs:

```yaml
github_username: jvanheerikhuize
test_mode: true                    # start with test mode!
test_repos: [dotfiles, a-sdlc]    # repos to audit in test mode
exclude_repos: [Roomba]           # repos to never audit
budget_usd: 10                    # max spend per run
model: claude-sonnet-4-20250514   # Claude model
max_specs_per_repo: 5             # cap on specs per repo
```

> Keep `test_mode: true` for the first few runs to validate output quality.

### Step 4: First Run (Manual Trigger)

1. Go to **Actions** tab in the `rsi` repo on GitHub
2. Pick a single dimension to start cheap, e.g. **RSI: Documentation Audit**
3. Click **Run workflow**
4. Set inputs:
   - **test_mode**: `true`
   - **budget_usd**: `2`
5. Click **Run workflow**
6. Watch the run logs to verify:
   - Repos are discovered and cloned
   - Claude API is called for the dimension
   - Specs are generated as valid YAML
   - PRs are opened in the target repos

You can also use the main **RSI Audit** workflow with a specific dimension:
- **dimensions**: `functional` (single) or `functional,documentation` (multiple) or `all`

### Step 5: Review Output

After the run completes:

1. Check the **Actions** summary tab for the run metrics table
2. Check your `dotfiles` and `a-sdlc` repos for new PRs labeled `rsi-audit`
3. Review the generated spec files in each PR:
   - Are findings accurate and specific?
   - Are acceptance criteria testable?
   - Are recommendations actionable?
4. Check `logs/research/` in the rsi repo for web research logs

### Step 6: Enable Scheduled Runs

Each dimension has its own schedule (one per day, staggered to spread costs):

| Workflow | Day | File |
|----------|-----|------|
| Functional | Monday | `dimension-functional.yml` |
| Non-functional | Tuesday | `dimension-non-functional.yml` |
| Feature ideas | Wednesday | `dimension-feature-ideas.yml` |
| Documentation | Thursday | `dimension-documentation.yml` |
| Cross-references | Friday | `dimension-cross-references.yml` |
| Web insights | Saturday | `dimension-web-insights.yml` |

To disable a dimension: comment out its `schedule` trigger in the workflow file. Each has its own $2 budget cap.

### Step 7: Graduate to Full Mode

When ready to audit all repos:

1. Edit `rsi.config.yaml`:
   ```yaml
   test_mode: false
   budget_usd: 20    # increase budget for more repos
   ```
2. Commit and push
3. Run manually once to verify, then let the cron take over

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `ANTHROPIC_API_KEY is not set` | Add the secret in repo Settings → Secrets |
| `Failed to fetch repos` | Check that your GitHub PAT has the correct scopes |
| `Clone failed` | Ensure the PAT has Contents read access to target repos |
| `PR creation failed` | Ensure the PAT has Pull requests write access |
| `Web search unavailable` | Public SearXNG instances may be down — set `SEARXNG_URL` to your own instance, or the DuckDuckGo fallback will be used |
| `Budget limit reached` | Increase `budget_usd` in config or workflow input |
| `yq not found` | The workflow installs yq automatically; for local runs: `sudo snap install yq` |

### Local Development

To run the pipeline locally:

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get install -y curl jq git
sudo wget -qO /usr/local/bin/yq \
  https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64
sudo chmod +x /usr/local/bin/yq

# Set environment variables
export ANTHROPIC_API_KEY="sk-ant-..."
export RSI_GITHUB_TOKEN="ghp_..."
export SEARXNG_URL="https://..."          # optional, for self-hosted SearXNG
export RSI_TEST_MODE="true"              # recommended for dev
export RSI_BUDGET_USD="5"                # keep low while testing

# Run
bash src/main.sh
```

### Cost Estimation

Approximate costs per dimension per run (Claude Sonnet, 2 test repos):

| Dimension | Estimated Cost | Notes |
|-----------|----------------|-------|
| Single dimension | $0.10 – $0.50 | 1 API session per repo |
| All 6 dimensions | $0.50 – $2.00 | For 2 repos in test mode |
| Full (all 19 repos, all dimensions) | $5 – $15 | Spread across 6 days = ~$1-2/day |

Each dimension workflow has its own $2 budget cap. By splitting across days, you stay under rate limits and spread costs to ~$1-2/day instead of $10+ in one burst.

## License

[MIT](LICENSE)
