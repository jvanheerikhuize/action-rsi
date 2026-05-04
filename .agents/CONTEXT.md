# Repository Context

<!-- Maintained by RSI audit system. Local agents: update this when you change architecture. -->
<!-- Last updated: 2026-04-12 by RSI audit -->

## Tech Stack
- Primary: typescript, javascript
- Build: npm, @vercel/ncc (bundle per action)
- CI: github-actions

## Architecture
AI-powered audit system that periodically reviews all repositories for quality, security, documentation, and improvement opportunities — then generates actionable spec files following the [A-SDLC](https://github.com/jvanheerikhuize/a-sdlc) governance framework.

Dimension-specific audit prompts are loaded dynamically from the `submodules/agent-roledefinitions` git submodule (S.E.N.T.R.Y., P.R.O.B.E., G.U.I.D.E., S.P.A.R.K. roles), with a built-in fallback to hardcoded prompts when the submodule is unavailable.

### Entry Points
- `actions/bootstrap/src/index.ts`
- `actions/context-build/src/index.ts`
- `actions/discover/src/index.ts`
- `actions/llm-analyze/src/index.ts`
- `actions/publish-results/src/index.ts`
- `actions/static-analysis/src/index.ts`

### Key Modules
| Module | Purpose | Dependencies |
|---|---|---|
| lib/types.ts | Core type definitions — the contract between all sub-actions | — |
| lib/roles/loader.ts | Load role prompts and context emphasis from agent-roledefinitions submodule | lib/types.ts |
| lib/prompts/system.ts | System prompt builder — loads from submodule roles, falls back to built-in | lib/types.ts, lib/prompts/dimensions.ts, lib/roles/loader.ts |
| lib/prompts/dimensions.ts | Built-in dimension-specific prompt fragments (fallback when submodule absent) | lib/types.ts |
| lib/llm/provider.ts | Provider interface + factory (anthropic, openai, google, ollama) | lib/types.ts |
| lib/context/persistent.ts | Parse/generate CONTEXT.md, apply context updates | lib/types.ts |
| lib/context/builder.ts | Heuristic repo analysis for bootstrap context scaffolding | lib/types.ts |
| lib/context/delta.ts | Compute git-based delta since last audit | lib/types.ts |
| lib/analyzers/runners.ts | Static analysis runner orchestration (shellcheck, gitleaks, trivy, ruff, eslint) | lib/types.ts, lib/rules/security-patterns.ts |
| lib/rules/security-patterns.ts | Declarative SAST pattern definitions | lib/types.ts |
| lib/formats/asdlc-spec.ts | Finding → A-SDLC YAML spec conversion | lib/types.ts |
| lib/formats/sarif.ts | Finding → SARIF 2.1.0 JSON conversion | lib/types.ts |
| lib/language-detect.ts | Language detection by file extension, entry point finder | lib/types.ts |
| lib/cost.ts | Per-pass token usage and cost tracking | lib/types.ts |
| lib/templates/agents-md.ts | AGENTS.md template as string constant | — |

## Conventions
- shell linting: shellcheck (configured via .shellcheckrc)
- ES modules throughout (package.json "type": "module")

## Dependency Graph
```
actions/bootstrap/src/index.ts → lib/context/builder.js, lib/context/persistent.js, lib/language-detect.js, lib/templates/agents-md.js, lib/types.js
actions/context → build/src/index.ts → lib/context/builder.js, lib/context/delta.js, lib/context/persistent.js, lib/language-detect.js, lib/types.js
actions/discover/src/index.ts → lib/types.js
actions/llm → analyze/src/index.ts → lib/cost.js, lib/prompts/dimensions.js, lib/prompts/system.js, lib/roles/loader.js, lib/context/persistent.js, lib/llm/provider.js, lib/types.js
actions/publish → results/src/index.ts → lib/formats/asdlc-spec.js, lib/formats/sarif.js, lib/types.js
actions/static → analysis/src/index.ts → lib/analyzers/runners.js, lib/language-detect.js, lib/types.js
lib/analyzers/runners.ts → lib/rules/security-patterns.js, lib/types.js
lib/context/builder.ts → lib/types.js
lib/context/delta.ts → lib/types.js
lib/context/persistent.ts → lib/types.js
lib/cost.ts → lib/types.js
lib/formats/asdlc → spec.ts → lib/types.js
lib/formats/sarif.ts → lib/types.js
lib/language → detect.ts → lib/types.js
lib/llm/anthropic.ts → lib/types.js, lib/llm/provider.js
lib/llm/google.ts → lib/types.js, lib/llm/provider.js
lib/llm/ollama.ts → lib/types.js, lib/llm/provider.js
lib/llm/openai.ts → lib/types.js, lib/llm/provider.js
lib/llm/provider.ts → lib/types.js
lib/prompts/dimensions.ts → lib/types.js
lib/prompts/system.ts → lib/types.js, lib/prompts/dimensions.js, lib/roles/loader.js
lib/roles/loader.ts → lib/types.js
lib/rules/security → patterns.ts → lib/types.js
lib/templates/agents → md.ts → (none)
```

## Known Concerns
- [2026-04-12] Context builder `normalizeImport()` used a naive dot-check for file extensions — fixed to use proper regex, but the generated dependency graphs may still miss edge cases for non-standard import patterns
- [2026-04-12] Lack of standardized error handling across action modules — each action handles errors independently with varying levels of detail
- [2026-04-12] Security risk from hardcoded tokens in git remote URLs - tokens could be exposed in process arguments or error messages
- [2026-04-12] Potential race conditions in parallel LLM pass execution when updating shared persistent context
- [2026-04-12] Shell command injection vulnerabilities from unescaped user input in git operations
- [2026-04-12] Dependency graph in CONTEXT.md contains incorrect .js extensions instead of .ts, causing massive context drift
- [2026-04-12] Inconsistent error handling patterns across action modules makes debugging difficult
- [2026-04-12] Parallel LLM passes may have race conditions when updating shared persistent context
- [2026-04-12] Dependency graph in CONTEXT.md is completely stale - references .js files that don't exist instead of actual .ts files
- [2026-04-12] Context builder normalizeImport() fix was applied but generated context was never refreshed
