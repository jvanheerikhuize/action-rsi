/**
 * Persistent context builder.
 *
 * Infers an initial PersistentContext from repo analysis.
 * Used for bootstrap (first audit) to generate .agents/CONTEXT.md.
 *
 * The inference here is heuristic and will be refined by LLM analysis
 * in the bootstrap PR — the bootstrap flow does a full-context LLM pass
 * specifically to produce a high-quality initial CONTEXT.md.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import type {
  LanguageProfile,
  Module,
  PersistentContext,
  RepoSummary,
} from "../types.js";

const FRAMEWORK_SIGNALS: Record<string, string[]> = {
  react: ["package.json:react"],
  vue: ["package.json:vue"],
  angular: ["angular.json"],
  next: ["next.config.js", "next.config.ts", "next.config.mjs"],
  express: ["package.json:express"],
  fastapi: ["requirements.txt:fastapi", "pyproject.toml:fastapi"],
  django: ["manage.py", "requirements.txt:django"],
  flask: ["requirements.txt:flask"],
  rails: ["Gemfile:rails", "config/routes.rb"],
  spring: ["pom.xml:spring", "build.gradle:spring"],
  gin: ["go.mod:gin-gonic/gin"],
  actix: ["Cargo.toml:actix"],
};

const BUILD_TOOL_SIGNALS: Record<string, string[]> = {
  make: ["Makefile"],
  cmake: ["CMakeLists.txt"],
  npm: ["package.json"],
  yarn: ["yarn.lock"],
  pnpm: ["pnpm-lock.yaml"],
  bun: ["bun.lockb"],
  pip: ["requirements.txt", "pyproject.toml"],
  poetry: ["poetry.lock"],
  cargo: ["Cargo.toml"],
  go: ["go.mod"],
  gradle: ["build.gradle", "build.gradle.kts"],
  maven: ["pom.xml"],
  bundler: ["Gemfile"],
};

const CI_SIGNALS: Record<string, string[]> = {
  "github-actions": [".github/workflows"],
  "gitlab-ci": [".gitlab-ci.yml"],
  "circleci": [".circleci/config.yml"],
  "travis": [".travis.yml"],
  "jenkins": ["Jenkinsfile"],
  "buildkite": [".buildkite"],
};

export interface BuilderInput {
  repoDir: string;
  repoName: string;
  filePaths: string[];
  languages: LanguageProfile[];
  repoSummary: RepoSummary;
  importGraph?: Record<string, string[]>;
}

/**
 * Build an initial PersistentContext from repo analysis.
 * This is a heuristic first-pass; the LLM will refine it.
 */
export function buildPersistentContext(input: BuilderInput, auditDate: string): PersistentContext {
  const { repoDir, languages, filePaths } = input;

  return {
    lastUpdated: auditDate,
    updatedBy: "RSI audit (bootstrap)",
    techStack: detectTechStack(repoDir, languages),
    architecture: {
      pattern: inferArchPattern(input),
      description: inferDescription(repoDir, input.repoSummary),
      entryPoints: findEntryPoints(languages),
      modules: identifyKeyModules(input),
    },
    conventions: detectConventions(repoDir, filePaths),
    dependencyGraph: input.importGraph ?? {},
    knownConcerns: [],
  };
}

function detectTechStack(repoDir: string, languages: LanguageProfile[]): PersistentContext["techStack"] {
  const primary = languages.slice(0, 3).map((l) => l.language);
  const frameworks: string[] = [];
  const build: string[] = [];
  const ci: string[] = [];

  for (const [framework, signals] of Object.entries(FRAMEWORK_SIGNALS)) {
    if (signalsMatch(repoDir, signals)) frameworks.push(framework);
  }
  for (const [tool, signals] of Object.entries(BUILD_TOOL_SIGNALS)) {
    if (signalsMatch(repoDir, signals)) build.push(tool);
  }
  for (const [system, signals] of Object.entries(CI_SIGNALS)) {
    if (signalsMatch(repoDir, signals)) ci.push(system);
  }

  return { primary, frameworks, build, ci };
}

function signalsMatch(repoDir: string, signals: string[]): boolean {
  for (const signal of signals) {
    if (signal.includes(":")) {
      const [file, keyword] = signal.split(":");
      if (fileContainsKeyword(`${repoDir}/${file}`, keyword)) return true;
    } else {
      if (existsSync(`${repoDir}/${signal}`)) return true;
    }
  }
  return false;
}

function fileContainsKeyword(path: string, keyword: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const content = readFileSync(path, "utf-8");
    return content.toLowerCase().includes(keyword.toLowerCase());
  } catch {
    return false;
  }
}

function inferArchPattern(input: BuilderInput): string {
  const { languages, repoSummary } = input;
  const primary = languages[0]?.language;

  if (!primary) return "unknown";

  // Heuristic patterns
  if (hasDir(input.repoDir, "src") && hasDir(input.repoDir, "tests")) return "src-layout with tests";
  if (hasDir(input.repoDir, "cmd") && primary === "go") return "Go cmd layout";
  if (hasDir(input.repoDir, "actions") || hasDir(input.repoDir, ".github/actions")) return "GitHub Action composition";
  if (primary === "shell") return "CLI scripts collection";
  if (repoSummary.fileCount < 20) return "small utility";
  if (languages.some((l) => l.language === "javascript" || l.language === "typescript") && hasDir(input.repoDir, "pages")) {
    return "Next.js-style app";
  }

  return `${primary} project`;
}

function inferDescription(repoDir: string, summary: RepoSummary): string {
  // Try README first
  for (const readme of ["README.md", "README.rst", "README.txt"]) {
    const path = `${repoDir}/${readme}`;
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const firstPara = extractFirstParagraph(content);
      if (firstPara) return firstPara;
    }
  }
  return summary.description || `A ${summary.languages ? Object.keys(summary.languages)[0] : "software"} project.`;
}

function extractFirstParagraph(markdown: string): string {
  const lines = markdown.split("\n");
  const body: string[] = [];
  let started = false;

  for (const line of lines) {
    if (line.startsWith("#") && !started) continue;
    if (line.startsWith("#") && started) break;
    const trimmed = line.trim();
    if (trimmed === "" && started) break;
    if (trimmed !== "") {
      started = true;
      body.push(trimmed);
    }
  }

  return body.join(" ").slice(0, 300);
}

function findEntryPoints(languages: LanguageProfile[]): string[] {
  const eps: string[] = [];
  for (const lang of languages) {
    eps.push(...lang.entryPoints);
  }
  return Array.from(new Set(eps));
}

function identifyKeyModules(input: BuilderInput): Module[] {
  const { repoDir, importGraph } = input;
  const modules: Module[] = [];

  // Modules are files that are imported by multiple other files
  if (importGraph) {
    const importCounts: Record<string, number> = {};
    for (const deps of Object.values(importGraph)) {
      for (const dep of deps) {
        importCounts[dep] = (importCounts[dep] ?? 0) + 1;
      }
    }

    const topImported = Object.entries(importCounts)
      .filter(([_, count]) => count >= 2)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 10);

    for (const [path, _count] of topImported) {
      modules.push({
        path,
        purpose: inferModulePurpose(repoDir, path),
        dependencies: importGraph[path] ?? [],
      });
    }
  }

  return modules;
}

function inferModulePurpose(repoDir: string, path: string): string {
  // Try to extract from file header comment
  const fullPath = `${repoDir}/${path}`;
  if (!existsSync(fullPath)) return "—";

  try {
    const content = readFileSync(fullPath, "utf-8").slice(0, 2000);
    // Look for first comment block
    const lines = content.split("\n");
    for (const line of lines.slice(0, 20)) {
      const trimmed = line.trim().replace(/^[#/\*\-\s]+/, "").trim();
      if (trimmed.length > 20 && trimmed.length < 150 && !trimmed.startsWith("!")) {
        return trimmed;
      }
    }
  } catch {
    // ignore
  }

  // Fall back to filename-based guess
  const basename = path.split("/").pop() ?? path;
  return `${basename.replace(/\.[^.]+$/, "")} module`;
}

function detectConventions(repoDir: string, _filePaths: string[]): Record<string, string> {
  const conventions: Record<string, string> = {};

  // Detect shell style
  if (existsSync(`${repoDir}/.editorconfig`)) {
    try {
      const content = readFileSync(`${repoDir}/.editorconfig`, "utf-8");
      const indent = content.match(/indent_style\s*=\s*(\w+)/);
      if (indent) conventions["indent style"] = indent[1];
      const size = content.match(/indent_size\s*=\s*(\d+)/);
      if (size) conventions["indent size"] = size[1];
    } catch {}
  }

  // Detect linter configs
  if (existsSync(`${repoDir}/.shellcheckrc`)) conventions["shell linting"] = "shellcheck (configured)";
  if (existsSync(`${repoDir}/.eslintrc.json`) || existsSync(`${repoDir}/eslint.config.js`)) {
    conventions["js/ts linting"] = "eslint";
  }
  if (existsSync(`${repoDir}/.prettierrc`) || existsSync(`${repoDir}/.prettierrc.json`)) {
    conventions["formatting"] = "prettier";
  }
  if (existsSync(`${repoDir}/ruff.toml`) || existsSync(`${repoDir}/pyproject.toml`)) {
    conventions["python linting"] = "ruff";
  }

  // Detect git commit style
  if (existsSync(`${repoDir}/.gitmessage`)) conventions["commit style"] = "custom template";
  if (existsSync(`${repoDir}/.github/PULL_REQUEST_TEMPLATE.md`)) conventions["PR format"] = "template required";

  return conventions;
}

function hasDir(repoDir: string, name: string): boolean {
  try {
    const stat = statSync(`${repoDir}/${name}`);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Compute a simple import graph from source files.
 * Used by the context builder to identify dependencies.
 */
export function computeImportGraph(repoDir: string, filePaths: string[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};

  for (const file of filePaths) {
    const ext = file.slice(file.lastIndexOf("."));
    const patterns = IMPORT_PATTERNS[ext];
    if (!patterns) continue;

    const fullPath = `${repoDir}/${file}`;
    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, "utf-8");
      const deps = new Set<string>();
      for (const pattern of patterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          const dep = normalizeImport(match[1], file, ext);
          if (dep) deps.add(dep);
        }
      }
      if (deps.size > 0) {
        graph[file] = Array.from(deps);
      }
    } catch {
      // skip unreadable files
    }
  }

  return graph;
}

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  ".sh": [/source\s+["']?([^"'\s;]+)/g, /^\s*\.\s+["']?([^"'\s;]+)/gm],
  ".bash": [/source\s+["']?([^"'\s;]+)/g, /^\s*\.\s+["']?([^"'\s;]+)/gm],
  ".js": [/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g],
  ".mjs": [/from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g],
  ".ts": [/from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g],
  ".tsx": [/from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g],
  ".py": [/^import\s+(\S+)/gm, /^from\s+(\S+)\s+import/gm],
  ".go": [/^\s*"([^"]+)"/gm],
  ".rs": [/^\s*use\s+([\w:]+)/gm],
};

function normalizeImport(imp: string, fromFile: string, ext: string): string | null {
  // Skip external/stdlib imports
  if (imp.startsWith(".") || imp.startsWith("/") || imp.includes("${") || imp.includes("$(")) {
    // Relative import — resolve
    if (imp.startsWith(".")) {
      const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
      const parts = fromDir ? fromDir.split("/") : [];
      const impParts = imp.split("/");
      for (const p of impParts) {
        if (p === "..") parts.pop();
        else if (p !== ".") parts.push(p);
      }
      let resolved = parts.join("/");
      if (resolved && !resolved.includes(".")) resolved += ext;
      return resolved || null;
    }
    return null;
  }

  // For shell: relative paths without leading dot (e.g., "lib/utils.sh")
  if ((ext === ".sh" || ext === ".bash") && imp.includes("/")) {
    return imp.replace(/^["']|["']$/g, "");
  }

  return null;
}
