/**
 * AGENTS.md template as a string constant.
 * This file is the instruction contract between RSI and local agents.
 * Embedded as a string so ncc-bundled actions don't need filesystem access.
 */

export const AGENTS_MD_TEMPLATE = `# Agent Instructions

This repository is maintained with the help of AI agents. If you are an agent working on this codebase (Claude Code, Cursor, Copilot, Aider, etc.), please follow these instructions.

## Before starting work

Read \`.agents/CONTEXT.md\` for:
- Repository architecture and key modules
- Tech stack and frameworks
- Coding conventions
- Dependency graph
- Known concerns to be aware of

Match the existing style. When in doubt, look at surrounding code.

## After completing a spec file

Spec files live in \`specs/features/\` (A-SDLC format). When you implement a spec:

1. **Implement the spec** as described in \`specs/features/FEAT-NNNN.yaml\`
2. **Update \`.agents/CONTEXT.md\`** if your changes affected:
   - Architecture pattern or description
   - Entry points (added/removed/renamed)
   - Key modules (added/removed, purpose changed, new dependencies)
   - Coding conventions (e.g., new error handling pattern)
   - Dependency graph (new imports, removed imports)
3. **Update Known Concerns**:
   - Remove concerns that your implementation resolved
   - Add new concerns for trade-offs you made or TODOs you left
4. **Delete the completed spec file** from \`specs/features/\`
5. **Update \`Last updated\`** in the CONTEXT.md header with today's date and your name/agent

## Format of CONTEXT.md

The file is structured markdown. Sections:
- **Tech Stack**: \`- Primary: lang1, lang2\`, etc.
- **Architecture**: Description, then \`### Entry Points\` and \`### Key Modules\` (table)
- **Conventions**: \`- key: value\` bullet list
- **Dependency Graph**: code block with \`file → dep1, dep2\` lines
- **Known Concerns**: \`- [YYYY-MM-DD] [severity] description\`

Keep sections in this order. Machine tools (RSI audit) parse this format.

## Spec file format

Specs follow the A-SDLC governance framework. See any existing spec in \`specs/features/\` for the exact format. Every spec has:
- \`metadata\`: id, title, severity, dimension
- \`problem_statement\`: what needs solving and why
- \`proposed_solution\`: the approach
- \`acceptance_criteria\`: testable conditions for completion

## Questions or issues?

If the instructions here conflict with the actual codebase, trust the code and update these instructions. If you encounter something unexpected, add a note to the Known Concerns section of CONTEXT.md.
`;
