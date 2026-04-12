/**
 * Declarative grep-based SAST rules.
 *
 * Extend by adding entries to SECURITY_PATTERNS — no code changes needed
 * beyond this file. Each rule is a regex scanned across files matching
 * the globs (shell-style extension patterns).
 *
 * Intentionally conservative: these are heuristic signals, not proof.
 * Tuned for low false-positive rates. High-noise categories (e.g.
 * broad eval detection in dynamic languages) intentionally omitted —
 * language-specific linters handle those better.
 */

import type { Severity } from "../types.js";

export interface SecurityPattern {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  pattern: RegExp;
  extensions: string[];
  description: string;
  recommendation: string;
}

export const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    id: "eval_usage",
    title: "Use of eval (potential code injection)",
    severity: "high",
    category: "code_injection",
    pattern: /\beval\s+["']?\$/,
    extensions: [".sh", ".bash", ".zsh"],
    description: "`eval` with variable expansion executes arbitrary strings as code.",
    recommendation: "Replace `eval` with direct invocation or a safe dispatch table.",
  },
  {
    id: "python_eval",
    title: "Use of eval()/exec() on untrusted input",
    severity: "high",
    category: "code_injection",
    pattern: /\b(eval|exec)\s*\(/,
    extensions: [".py"],
    description: "`eval`/`exec` on anything touching input is a code-execution sink.",
    recommendation: "Use `ast.literal_eval` for data, or an explicit dispatch for logic.",
  },
  {
    id: "js_eval",
    title: "Use of eval / new Function",
    severity: "high",
    category: "code_injection",
    pattern: /\b(eval\s*\(|new\s+Function\s*\()/,
    extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx"],
    description: "`eval` and `new Function(string)` execute arbitrary code.",
    recommendation: "Parse input explicitly; avoid dynamic code construction.",
  },
  {
    id: "unsafe_temp",
    title: "Predictable temp file path",
    severity: "medium",
    category: "filesystem",
    pattern: /(mktemp\s+-t\b(?!\s*--\s*-[dD])|\/tmp\/[a-zA-Z0-9_.-]+\b(?!XXXXXX))/,
    extensions: [".sh", ".bash"],
    description: "Predictable temp file paths enable TOCTOU and symlink attacks.",
    recommendation: "Use `mktemp` without `-t` shorthand; pass a template with `XXXXXX`.",
  },
  {
    id: "curl_insecure",
    title: "curl with disabled SSL verification",
    severity: "high",
    category: "transport_security",
    pattern: /curl\s[^|&;\n]*(-k\b|--insecure\b)/,
    extensions: [".sh", ".bash", ".yml", ".yaml", ".Dockerfile", ".dockerfile"],
    description: "`curl -k` disables TLS certificate verification.",
    recommendation: "Remove `-k`; ensure the server presents a valid cert, or pin a CA.",
  },
  {
    id: "wget_no_check",
    title: "wget with disabled certificate check",
    severity: "high",
    category: "transport_security",
    pattern: /wget\s[^|&;\n]*--no-check-certificate\b/,
    extensions: [".sh", ".bash", ".yml", ".yaml", ".Dockerfile", ".dockerfile"],
    description: "`--no-check-certificate` disables TLS verification.",
    recommendation: "Remove the flag and configure proper certificates.",
  },
  {
    id: "hardcoded_password",
    title: "Possible hardcoded password",
    severity: "high",
    category: "secrets",
    pattern: /(password|passwd|pwd)\s*[:=]\s*["'][^"'\s${}]{6,}["']/i,
    extensions: [".sh", ".bash", ".py", ".js", ".ts", ".tsx", ".yaml", ".yml", ".json", ".env"],
    description: "String literals matching password-like assignments suggest embedded credentials.",
    recommendation: "Load from environment or a secret manager.",
  },
  {
    id: "hardcoded_api_key",
    title: "Possible hardcoded API key / token",
    severity: "high",
    category: "secrets",
    pattern: /(api[_-]?key|auth[_-]?token|access[_-]?token|secret[_-]?key|bearer)\s*[:=]\s*["'][A-Za-z0-9+/_\-]{20,}["']/i,
    extensions: [".sh", ".bash", ".py", ".js", ".ts", ".tsx", ".yaml", ".yml", ".json"],
    description: "High-entropy string matching a credential-shaped assignment.",
    recommendation: "Move to environment / secret store. Rotate any key that was committed.",
  },
  {
    id: "chmod_777",
    title: "World-writable permissions (chmod 777)",
    severity: "medium",
    category: "filesystem",
    pattern: /\bchmod\s+-?[Rr]?\s*0?777\b/,
    extensions: [".sh", ".bash", ".Dockerfile", ".dockerfile"],
    description: "`chmod 777` grants write access to all users.",
    recommendation: "Grant least privilege — typically 755 for dirs, 644 for files.",
  },
  {
    id: "sudo_nopasswd",
    title: "NOPASSWD in sudoers configuration",
    severity: "high",
    category: "privilege_escalation",
    pattern: /\bNOPASSWD\b/,
    extensions: [".sh", ".bash", ".conf", ".yml", ".yaml"],
    description: "`NOPASSWD` grants passwordless sudo — wide blast radius.",
    recommendation: "Scope NOPASSWD to specific commands, or remove it entirely.",
  },
  {
    id: "shell_pipe_to_shell",
    title: "Piping remote content directly to shell",
    severity: "high",
    category: "supply_chain",
    pattern: /(curl|wget)\s[^|&;\n]*\|\s*(sh|bash|zsh)\b/,
    extensions: [".sh", ".bash", ".md", ".Dockerfile", ".dockerfile"],
    description: "`curl … | sh` executes remote code without integrity checks.",
    recommendation: "Download, verify checksum/signature, then execute.",
  },
  {
    id: "sql_string_concat",
    title: "SQL query built via string concatenation",
    severity: "high",
    category: "injection",
    pattern: /(SELECT|INSERT|UPDATE|DELETE)\s.+(\+|\.format\(|%\s|%\{|`\s*\$\{)/i,
    extensions: [".py", ".js", ".ts", ".tsx", ".go", ".rb", ".php"],
    description: "Dynamic SQL built from string interpolation suggests injection risk.",
    recommendation: "Use parameterized queries / prepared statements.",
  },
];

/**
 * Globs that should NEVER be scanned — vendored code, build artifacts,
 * lockfiles, and the rules themselves (which contain the patterns
 * they check for and would self-flag).
 */
export const PATTERN_IGNORE_DIRS = [
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  "specs",
];

export const PATTERN_IGNORE_FILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Cargo.lock",
  "security-patterns.ts", // self-exclude
];
