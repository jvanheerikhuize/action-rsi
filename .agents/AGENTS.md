# Agent Instructions

This repository is maintained with the help of AI agents. If you are an agent working on this codebase (Claude Code, Cursor, Copilot, Aider, etc.), please follow these instructions.

## Before starting work

Read `.agents/CONTEXT.md` for:
- Repository architecture and key modules
- Tech stack and frameworks
- Coding conventions
- Dependency graph
- Known concerns to be aware of

Match the existing style. When in doubt, look at surrounding code.

## Submodules

This repo uses a git submodule at `submodules/agent-roledefinitions` for audit role definitions. If it's not initialized:

```bash
git submodule update --init
```

Role definitions (S.E.N.T.R.Y., P.R.O.B.E., G.U.I.D.E., S.P.A.R.K., R.S.I.) live in that submodule. The system falls back to built-in prompts in `lib/prompts/dimensions.ts` when the submodule is absent.

## After making changes

1. **Update `.agents/CONTEXT.md`** if your changes affected:
   - Architecture pattern or description
   - Entry points (added/removed/renamed)
   - Key modules (added/removed, purpose changed, new dependencies)
   - Coding conventions (e.g., new error handling pattern)
   - Dependency graph (new imports, removed imports)
2. **Update Known Concerns**:
   - Remove concerns that your implementation resolved
   - Add new concerns for trade-offs you made or TODOs you left
3. **Update `Last updated`** in the CONTEXT.md header with today's date and your name/agent
4. **Rebuild bundles** if you changed any TypeScript: `npm run bundle`

## Format of CONTEXT.md

The file is structured markdown. Sections:
- **Tech Stack**: `- Primary: lang1, lang2`, etc.
- **Architecture**: Description, then `### Entry Points` and `### Key Modules` (table)
- **Conventions**: `- key: value` bullet list
- **Dependency Graph**: code block with `file → dep1, dep2` lines
- **Known Concerns**: `- [YYYY-MM-DD] description`

Keep sections in this order. Machine tools (RSI audit) parse this format.

## Questions or issues?

If the instructions here conflict with the actual codebase, trust the code and update these instructions. If you encounter something unexpected, add a note to the Known Concerns section of CONTEXT.md.
