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
| **Web insights** | Emerging trends, new libraries, techniques, and advisories via web research |

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

**Brave Search API key (optional, for web research):**
1. Go to [brave.com/search/api](https://brave.com/search/api/)
2. Sign up for the free tier (2,000 queries/month)
3. Copy your API key

### Step 2: Configure Repository Secrets

In the `rsi` repo on GitHub:

1. Go to **Settings → Secrets and variables → Actions**
2. Add these **Repository secrets**:

| Secret | Value |
|--------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `RSI_GITHUB_TOKEN` | Your GitHub PAT |
| `BRAVE_SEARCH_API_KEY` | *(optional)* Brave Search API key |

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
2. Select the **RSI Audit** workflow
3. Click **Run workflow**
4. Set inputs:
   - **test_mode**: `true`
   - **budget_usd**: `5` (conservative for first run)
5. Click **Run workflow**
6. Watch the run logs to verify:
   - Repos are discovered and cloned
   - Claude API is called for each dimension
   - Specs are generated as valid YAML
   - PRs are opened in the target repos

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

Once you're satisfied with the output quality:

1. The cron schedule is already configured in `.github/workflows/rsi-audit.yml`:
   ```yaml
   schedule:
     - cron: '0 6 * * 1'  # Every Monday at 06:00 UTC
   ```
2. The workflow will run automatically — no further action needed

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
| `Web search unavailable` | Set `BRAVE_SEARCH_API_KEY` secret (optional) |
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
export BRAVE_SEARCH_API_KEY="..."        # optional
export RSI_TEST_MODE="true"              # recommended for dev
export RSI_BUDGET_USD="5"                # keep low while testing

# Run
bash src/main.sh
```

### Cost Estimation

Approximate costs per run (Claude Sonnet):

| Scope | Repos | Estimated Cost |
|-------|-------|----------------|
| Test mode | 2 repos | $1 – $3 |
| Small batch | 5 repos | $3 – $7 |
| Full (all 19) | 19 repos | $8 – $20 |

Actual cost depends on repo size, number of tool calls, and findings. The budget cap ensures you never exceed your limit.

## License

[MIT](LICENSE)
