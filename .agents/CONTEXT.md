# Repository Context

<!-- Maintained by RSI audit system. Local agents: update this when you change architecture. -->
<!-- Last updated: 2026-04-12 by RSI audit (bootstrap) -->

## Tech Stack
- Primary: typescript, javascript
- Build: npm
- CI: github-actions

## Architecture
AI-powered audit system that periodically reviews all repositories for quality, security, documentation, and improvement opportunities — then generates actionable spec files following the [A-SDLC](https://github.com/jvanheerikhuize/a-sdlc) governance framework.

### Entry Points
- `actions/bootstrap/src/index.ts`
- `actions/context-build/src/index.ts`
- `actions/discover/src/index.ts`
- `actions/llm-analyze/src/index.ts`
- `actions/publish-results/src/index.ts`
- `actions/static-analysis/src/index.ts`
- `lib/templates/index.ts`
- `actions/bootstrap/dist/index.js`
- `actions/context-build/dist/index.js`
- `actions/discover/dist/index.js`
- `actions/llm-analyze/dist/278.index.js`
- `actions/llm-analyze/dist/454.index.js`
- `actions/llm-analyze/dist/766.index.js`
- `actions/llm-analyze/dist/947.index.js`
- `actions/llm-analyze/dist/index.js`
- `actions/publish-results/dist/index.js`
- `actions/static-analysis/dist/index.js`

### Key Modules
| Module | Purpose | Dependencies |
|---|---|---|
| lib/types.js | — | — |
| lib/llm/provider.js | — | — |
| lib/context/persistent.js | — | — |
| lib/language-detect.js | — | — |
| lib/context/builder.js | — | — |
| lib/templates/agents-md.js | — | — |
| lib/prompts/dimensions.js | — | — |

## Conventions
- shell linting: shellcheck (configured)

## Dependency Graph
```
actions/bootstrap/src/index.ts → lib/context/builder.js, lib/context/persistent.js, lib/language-detect.js, lib/templates/agents-md.js, lib/types.js
actions/context-build/src/index.ts → lib/context/builder.js, lib/context/delta.js, lib/context/persistent.js, lib/language-detect.js, lib/types.js
actions/discover/src/index.ts → lib/types.js
actions/llm-analyze/src/index.ts → lib/cost.js, lib/prompts/dimensions.js, lib/prompts/system.js, lib/context/persistent.js, lib/llm/provider.js, lib/types.js
actions/publish-results/src/index.ts → lib/formats/asdlc-spec.js, lib/formats/sarif.js, lib/types.js
actions/static-analysis/src/index.ts → lib/analyzers/runners.js, lib/language-detect.js, lib/types.js
lib/analyzers/runners.ts → lib/rules/security-patterns.js, lib/types.js
lib/context/builder.ts → lib/types.js
lib/context/delta.ts → lib/types.js
lib/context/persistent.ts → lib/types.js
lib/cost.ts → lib/types.js
lib/formats/asdlc-spec.ts → lib/types.js
lib/formats/sarif.ts → lib/types.js
lib/language-detect.ts → lib/types.js
lib/llm/anthropic.ts → lib/types.js, lib/llm/provider.js
lib/llm/google.ts → lib/types.js, lib/llm/provider.js
lib/llm/ollama.ts → lib/types.js, lib/llm/provider.js
lib/llm/openai.ts → lib/types.js, lib/llm/provider.js
lib/llm/provider.ts → lib/types.js
lib/prompts/dimensions.ts → lib/types.js
lib/prompts/system.ts → lib/types.js, lib/prompts/dimensions.js
lib/rules/security-patterns.ts → lib/types.js
lib/templates/index.ts → lib/templates/agents-md.js
```
