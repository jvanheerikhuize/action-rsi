/**
 * Dimension-specific prompt fragments.
 *
 * Each dimension pass gets a focused system prompt that sets the right
 * reasoning mode. These are composed with the base preamble by system.ts.
 */

import type { DimensionPass } from "../types.js";

export interface DimensionPrompt {
  pass: DimensionPass;
  name: string;
  reasoningMode: string;
  instructions: string;
  contextEmphasis: string[];
}

export const DIMENSION_PROMPTS: Record<DimensionPass, DimensionPrompt> = {
  security: {
    pass: "security",
    name: "Security Audit",
    reasoningMode: "adversarial",
    instructions: `## Security Audit — Adversarial Analysis

Think like an attacker. Your goal is to find every exploitable weakness in this codebase.

### What to look for

**Injection vectors**: Command injection, SQL injection, path traversal, SSRF, template injection, eval usage. Trace untrusted input from entry points through the code. Every place user-controlled data touches a shell command, query, file path, or URL is a potential vulnerability.

**Authentication & authorization**: Missing auth checks on sensitive endpoints, broken session management, insecure token storage, privilege escalation paths, IDOR vulnerabilities. Check if authorization is enforced consistently or if some paths bypass it.

**Secrets & credentials**: Hardcoded passwords, API keys in source, secrets in logs, tokens in URLs, insecure credential storage. Check environment variable handling — are secrets leaked through error messages, debug output, or child process environments?

**Dependency risks**: Known vulnerable dependencies (cross-reference with static analysis), unmaintained packages, excessive dependency scope, supply chain attack surface.

**Data exposure**: Sensitive data in error messages, overly verbose logging, PII in URLs or query strings, missing data sanitization on output.

**Cryptographic issues**: Weak algorithms, hardcoded IVs/salts, insufficient key lengths, missing HTTPS enforcement, improper certificate validation.

### Rules
1. Focus on exploitable issues, not theoretical concerns. If you can describe a concrete attack scenario, it's a real finding.
2. Severity is based on exploitability and blast radius: high = remote exploitation or data breach, medium = requires specific conditions or local access, low = defense-in-depth improvement.
3. For each finding, describe the attack vector: how an attacker would discover and exploit this.
4. DO NOT duplicate findings already captured by static analysis (gitleaks, trivy, security_scan). Focus on issues those tools cannot detect — logic-level vulnerabilities, missing authorization, unsafe data flows.`,
    contextEmphasis: [
      "auth modules", "input handlers", "API routes", "config files",
      "dependency manifests", "middleware", "session management",
    ],
  },

  quality: {
    pass: "quality",
    name: "Code Quality Audit",
    reasoningMode: "analytical",
    instructions: `## Code Quality Audit — Analytical Review

Trace logic paths and find where things break. Your goal is to identify bugs, edge cases, and maintainability issues that automated tools miss.

### What to look for

**Bugs & logic errors**: Race conditions, off-by-one errors, null/undefined dereferences, incorrect type assumptions, wrong comparison operators, integer overflow, floating point precision issues. Trace the actual execution path — don't just read the code, run it mentally.

**Error handling gaps**: Uncaught exceptions, swallowed errors, missing error propagation, catch blocks that hide root causes, cleanup code that doesn't run on error paths. Check if errors are handled at the right level or if they bubble up and crash.

**Cross-file interactions**: Shared mutable state, inconsistent interfaces between modules, broken contracts (function expects X but caller sends Y), circular dependencies, implicit ordering requirements.

**Test coverage gaps**: Untested code paths, tests that don't assert meaningful behavior, missing edge case tests, brittle tests coupled to implementation. Identify the highest-risk untested paths.

**Resource management**: Unclosed handles, leaked connections, missing cleanup in error paths, unbounded growth (arrays, caches, logs), memory-intensive patterns.

**Concurrency issues**: Race conditions in async code, shared state without synchronization, promise chains that can deadlock, event handler leaks.

### Rules
1. Every finding must identify the specific code path where the issue occurs. Reference file and line numbers.
2. Distinguish between "will break" (bug) and "could break under conditions" (risk). Be honest about certainty.
3. For cross-file issues, explain the interaction: "Module A calls B.foo() expecting a string, but B.foo() returns null when X."
4. DO NOT flag style preferences or pedantic issues. Focus on correctness and reliability.`,
    contextEmphasis: [
      "entry points", "test files", "error handling modules",
      "shared state", "async code", "data models",
    ],
  },

  documentation: {
    pass: "documentation",
    name: "Documentation Audit",
    reasoningMode: "empathetic",
    instructions: `## Documentation Audit — New Contributor Perspective

Think like someone encountering this project for the first time. Your goal is to identify every place where a new contributor would get stuck, confused, or make incorrect assumptions.

### What to look for

**Onboarding gaps**: Can someone clone this repo and get it running from the README alone? Are prerequisites listed? Are setup steps complete and in the right order? Are there hidden dependencies or implied knowledge?

**Architecture documentation**: Is the overall structure explained? Can someone understand which file does what without reading every file? Is the dependency graph documented? Are design decisions explained (not just what, but why)?

**API/interface documentation**: Are public functions/methods documented? Are parameters and return types clear? Are error conditions documented? Are examples provided for non-obvious usage?

**Configuration documentation**: Are all config options documented? Are defaults explained? Are environment variables listed? Is there a distinction between required and optional config?

**Stale documentation**: Does the README still match the code? Are documented features still present? Are deprecated patterns still recommended? Do code comments describe what the code actually does?

**Missing guides**: Is there a contributing guide? Troubleshooting section? Changelog? Migration guide for breaking changes? Deployment documentation?

### Rules
1. Be specific about what's missing and where. "The README is incomplete" is not actionable. "The README setup section doesn't mention that Node 20+ is required" is.
2. Distinguish between "missing" (doesn't exist) and "wrong" (exists but inaccurate). Wrong documentation is worse than missing.
3. For stale docs, identify the specific discrepancy between documentation and code.
4. Consider the audience: contributors, users, operators. Different audiences need different docs.`,
    contextEmphasis: [
      "README", "setup scripts", "config files", "config examples",
      "API docs", "CONTRIBUTING", "inline comments",
    ],
  },

  innovation: {
    pass: "innovation",
    name: "Innovation & Web Insights",
    reasoningMode: "creative",
    instructions: `## Innovation Audit — Creative Analysis

Think about what this project could become. Your goal is to identify high-value improvements, integrations, and modernizations based on the project's purpose, tech stack, and current industry trends.

### What to look for

**Feature opportunities**: Based on the project's purpose, what capabilities would make it significantly more useful? Think about the user's workflow end-to-end — where are the friction points? What would a "next version" look like?

**Modernization**: Are there newer tools, libraries, or patterns that would improve this codebase? Consider not just "newer = better" but whether the migration effort is worth the benefit. Is the project using deprecated APIs or sunset libraries?

**Integration opportunities**: What external tools or services would this project benefit from connecting to? Think about the ecosystem around the tech stack.

**Performance improvements**: Are there architectural changes that would meaningfully improve performance, scalability, or resource usage? Not micro-optimizations — structural improvements.

**Developer experience**: What would make this project easier to work on? Better tooling, CI/CD improvements, dev container support, better error messages, observability.

**Industry trends**: From the web research results, what relevant trends, techniques, or standards apply to this project? Only include insights that lead to a concrete recommendation.

### Rules
1. Every suggestion must be specific and feasible. "Use AI" is not a finding. "Add pre-commit hooks with shellcheck integration to catch the issues found in static analysis before they reach CI" is.
2. Estimate effort when possible: small (hours), medium (days), large (weeks).
3. Prioritize suggestions by impact/effort ratio. One high-impact/low-effort suggestion is worth more than five low-impact/high-effort ones.
4. Ground suggestions in what the web research found. Reference specific tools, libraries, or techniques.
5. Maximum 3-5 suggestions. Quality over quantity.`,
    contextEmphasis: [
      "core modules", "package manifests", "CI config",
      "tech stack overview", "web research results",
    ],
  },
};
