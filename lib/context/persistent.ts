/**
 * Persistent context management.
 *
 * Reads, writes, and diffs .agents/CONTEXT.md files in client repos.
 * The persistent context is maintained by RSI and local agents alike.
 */

import type { KnownConcern, Module, PersistentContext, Severity } from "../types.js";

const CONTEXT_PATH = ".agents/CONTEXT.md";
const HEADER_COMMENT = "<!-- Maintained by RSI audit system. Local agents: update this when you change architecture. -->";

/**
 * Parse a CONTEXT.md file into a structured PersistentContext.
 */
export function parseContextMd(content: string): PersistentContext {
  const ctx: PersistentContext = {
    lastUpdated: "",
    updatedBy: "",
    techStack: { primary: [], build: [], ci: [], frameworks: [] },
    architecture: { pattern: "", description: "", entryPoints: [], modules: [] },
    conventions: {},
    dependencyGraph: {},
    knownConcerns: [],
  };

  // Extract last updated metadata from comment
  const updatedMatch = content.match(/<!-- Last updated: (\S+) by (.+?) -->/);
  if (updatedMatch) {
    ctx.lastUpdated = updatedMatch[1];
    ctx.updatedBy = updatedMatch[2];
  }

  // Parse sections by ## headers
  const sections = splitSections(content);

  for (const [header, body] of sections) {
    const normalized = header.toLowerCase().trim();

    if (normalized === "tech stack") {
      ctx.techStack = parseTechStack(body);
    } else if (normalized === "architecture") {
      ctx.architecture = parseArchitecture(body);
    } else if (normalized === "conventions") {
      ctx.conventions = parseConventions(body);
    } else if (normalized === "dependency graph") {
      ctx.dependencyGraph = parseDependencyGraph(body);
    } else if (normalized === "known concerns") {
      ctx.knownConcerns = parseKnownConcerns(body);
    }
  }

  return ctx;
}

/**
 * Generate a CONTEXT.md file from a PersistentContext.
 */
export function generateContextMd(ctx: PersistentContext): string {
  const lines: string[] = [];

  lines.push("# Repository Context");
  lines.push("");
  lines.push(HEADER_COMMENT);
  lines.push(`<!-- Last updated: ${ctx.lastUpdated} by ${ctx.updatedBy} -->`);
  lines.push("");

  // Tech Stack
  lines.push("## Tech Stack");
  if (ctx.techStack.primary.length) lines.push(`- Primary: ${ctx.techStack.primary.join(", ")}`);
  if (ctx.techStack.frameworks.length) lines.push(`- Frameworks: ${ctx.techStack.frameworks.join(", ")}`);
  if (ctx.techStack.build.length) lines.push(`- Build: ${ctx.techStack.build.join(", ")}`);
  if (ctx.techStack.ci.length) lines.push(`- CI: ${ctx.techStack.ci.join(", ")}`);
  lines.push("");

  // Architecture
  lines.push("## Architecture");
  if (ctx.architecture.description) lines.push(ctx.architecture.description);
  lines.push("");

  if (ctx.architecture.entryPoints.length) {
    lines.push("### Entry Points");
    for (const ep of ctx.architecture.entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push("");
  }

  if (ctx.architecture.modules.length) {
    lines.push("### Key Modules");
    lines.push("| Module | Purpose | Dependencies |");
    lines.push("|---|---|---|");
    for (const mod of ctx.architecture.modules) {
      const deps = mod.dependencies.length ? mod.dependencies.join(", ") : "—";
      lines.push(`| ${mod.path} | ${mod.purpose} | ${deps} |`);
    }
    lines.push("");
  }

  // Conventions
  if (Object.keys(ctx.conventions).length) {
    lines.push("## Conventions");
    for (const [key, value] of Object.entries(ctx.conventions)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push("");
  }

  // Dependency Graph
  if (Object.keys(ctx.dependencyGraph).length) {
    lines.push("## Dependency Graph");
    lines.push("```");
    for (const [file, deps] of Object.entries(ctx.dependencyGraph)) {
      if (deps.length) {
        lines.push(`${file} → ${deps.join(", ")}`);
      }
    }
    lines.push("```");
    lines.push("");
  }

  // Known Concerns
  if (ctx.knownConcerns.length) {
    lines.push("## Known Concerns");
    for (const concern of ctx.knownConcerns) {
      if (!concern.resolved) {
        const sevTag = concern.severity !== "medium" ? ` [${concern.severity}]` : "";
        lines.push(`- [${concern.date}]${sevTag} ${concern.description}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Apply updates from an LLM audit pass to an existing persistent context.
 */
export function applyContextUpdates(
  existing: PersistentContext,
  updates: {
    newConcerns?: string[];
    resolvedConcerns?: string[];
    architectureChanges?: string[];
  },
  auditDate: string,
): PersistentContext {
  const updated = structuredClone(existing);
  updated.lastUpdated = auditDate;
  updated.updatedBy = "RSI audit";

  // Resolve concerns
  if (updates.resolvedConcerns) {
    for (const resolved of updates.resolvedConcerns) {
      const match = updated.knownConcerns.find(
        (c) => !c.resolved && c.description.toLowerCase().includes(resolved.toLowerCase()),
      );
      if (match) match.resolved = true;
    }
  }

  // Add new concerns
  if (updates.newConcerns) {
    for (const concern of updates.newConcerns) {
      updated.knownConcerns.push({
        date: auditDate,
        description: concern,
        severity: "medium",
      });
    }
  }

  return updated;
}

/**
 * Check if a CONTEXT.md exists in a repo directory.
 */
export function contextExists(repoDir: string): boolean {
  try {
    const fs = require("fs") as typeof import("fs");
    return fs.existsSync(`${repoDir}/${CONTEXT_PATH}`);
  } catch {
    return false;
  }
}

export function getContextPath(): string {
  return CONTEXT_PATH;
}

// ── Parsers ─────────────────────────────────────────────────────────────

function splitSections(content: string): Array<[string, string]> {
  const sections: Array<[string, string]> = [];
  const lines = content.split("\n");
  let currentHeader = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      if (currentHeader) {
        sections.push([currentHeader, currentBody.join("\n")]);
      }
      currentHeader = h2Match[1];
      currentBody = [];
    } else if (currentHeader) {
      currentBody.push(line);
    }
  }

  if (currentHeader) {
    sections.push([currentHeader, currentBody.join("\n")]);
  }

  return sections;
}

function parseTechStack(body: string): PersistentContext["techStack"] {
  const stack: PersistentContext["techStack"] = { primary: [], build: [], ci: [], frameworks: [] };

  for (const line of body.split("\n")) {
    const match = line.match(/^- (\w+):\s*(.+)/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const values = match[2].split(",").map((s) => s.trim()).filter(Boolean);
    if (key === "primary") stack.primary = values;
    else if (key === "frameworks") stack.frameworks = values;
    else if (key === "build") stack.build = values;
    else if (key === "ci") stack.ci = values;
  }

  return stack;
}

function parseArchitecture(body: string): PersistentContext["architecture"] {
  const arch: PersistentContext["architecture"] = {
    pattern: "", description: "", entryPoints: [], modules: [],
  };

  const subSections = body.split(/### /);
  // First sub-section is the description
  arch.description = subSections[0].trim();

  for (const sub of subSections.slice(1)) {
    const firstNewline = sub.indexOf("\n");
    const subHeader = sub.slice(0, firstNewline).trim().toLowerCase();
    const subBody = sub.slice(firstNewline + 1);

    if (subHeader === "entry points") {
      arch.entryPoints = subBody
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.replace(/^- `?/, "").replace(/`.*/, "").trim());
    } else if (subHeader === "key modules") {
      arch.modules = parseModuleTable(subBody);
    }
  }

  return arch;
}

function parseModuleTable(body: string): Module[] {
  const modules: Module[] = [];
  const lines = body.split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));

  // Skip header row
  for (const line of lines.slice(1)) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      modules.push({
        path: cells[0],
        purpose: cells[1],
        dependencies: cells[2] && cells[2] !== "—" ? cells[2].split(",").map((s) => s.trim()) : [],
      });
    }
  }

  return modules;
}

function parseConventions(body: string): Record<string, string> {
  const conventions: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = line.match(/^- (.+?):\s*(.+)/);
    if (match) conventions[match[1]] = match[2];
  }
  return conventions;
}

function parseDependencyGraph(body: string): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  // Look for lines inside code blocks: "file → dep1, dep2"
  const inCode = body.includes("```");
  const lines = inCode
    ? body.replace(/```\w*/g, "").split("\n")
    : body.split("\n");

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*[→>-]+\s*(.+)/);
    if (match) {
      const file = match[1].trim();
      const deps = match[2].split(",").map((s) => s.trim()).filter(Boolean);
      graph[file] = deps;
    }
  }

  return graph;
}

function parseKnownConcerns(body: string): KnownConcern[] {
  const concerns: KnownConcern[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]\s*(?:\[(\w+)\]\s*)?(.+)/);
    if (match) {
      concerns.push({
        date: match[1],
        severity: (match[2] as Severity) ?? "medium",
        description: match[3].trim(),
      });
    }
  }
  return concerns;
}
