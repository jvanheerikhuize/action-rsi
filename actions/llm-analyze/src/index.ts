/**
 * LLM-analyze sub-action entry point.
 *
 * Runs one LLM call per dimension pass (security, quality, documentation,
 * innovation). Each pass gets its own system prompt tuned for that
 * reasoning mode, plus dimension-relevant file emphasis. Per-pass
 * findings and context_updates are merged into a single AuditResult.
 *
 * Provider-agnostic via LLMProvider interface. Passes run in parallel.
 */

import * as core from "@actions/core";
import { readFileSync, writeFileSync } from "node:fs";
import { CostTracker } from "../../../lib/cost.js";
import { DIMENSION_PROMPTS } from "../../../lib/prompts/dimensions.js";
import { buildSystemPrompt, buildUserMessage } from "../../../lib/prompts/system.js";
import { applyContextUpdates, generateContextMd } from "../../../lib/context/persistent.js";
import { createProvider, type LLMProviderConfig } from "../../../lib/llm/provider.js";
import type {
  AuditCost,
  AuditResult,
  ContextBundle,
  DimensionPass,
  Finding,
  KeyFile,
  PassResult,
  PersistentContext,
} from "../../../lib/types.js";

interface LlmJsonOutput {
  findings: Array<Omit<Finding, "id" | "source" | "dimension"> & {
    dimension?: Finding["dimension"];
    files_affected?: string[];
  }>;
  context_updates?: {
    new_concerns?: string[];
    resolved_concerns?: string[];
    architecture_changes?: string[];
  };
  summary?: string;
}

async function run(): Promise<void> {
  const bundlePath = core.getInput("context-bundle", { required: true });
  const provider = core.getInput("provider") || "anthropic";
  const model = core.getInput("model") || "claude-sonnet-4-20250514";
  const apiKey = core.getInput("api-key");
  const baseUrl = core.getInput("base-url");
  const passesInput = core.getInput("passes") || "security,quality,documentation,innovation";
  const maxTokens = Number.parseInt(core.getInput("max-output-tokens") || "8192", 10);
  const findingsOut = core.getInput("findings-path") || "llm-findings.json";
  const resultOut = core.getInput("audit-result-path") || "audit-result.json";
  const contextOut = core.getInput("updated-context-path") || "updated-context.md";
  const auditDate = core.getInput("audit-date") || new Date().toISOString().slice(0, 10);

  if (provider !== "ollama" && !apiKey) {
    throw new Error(`api-key input is required for provider '${provider}'.`);
  }

  const bundle: ContextBundle = JSON.parse(readFileSync(bundlePath, "utf-8"));
  const passes = parsePasses(passesInput);
  core.info(`Running ${passes.length} passes over ${bundle.repo}: ${passes.join(", ")}`);

  const llm = await createProvider({
    provider: provider as LLMProviderConfig["provider"],
    model,
    apiKey: apiKey || "not-needed",
    baseUrl: baseUrl || undefined,
  });

  const tracker = new CostTracker();
  const passResults: PassResult[] = [];
  const allFindings: Finding[] = [];
  const summaries: string[] = [];
  const mergedUpdates: Required<NonNullable<LlmJsonOutput["context_updates"]>> = {
    new_concerns: [],
    resolved_concerns: [],
    architecture_changes: [],
  };

  // Passes are independent — run in parallel. Each uses the same cached
  // system prompt (per-pass), benefitting from provider prompt caching.
  const settled = await Promise.all(
    passes.map((pass) => runPass({ pass, bundle, llm, maxTokens })),
  );

  for (const r of settled) {
    if (!r) continue;
    tracker.record(bundle.repo, r.pass, r.usage, r.costUsd);
    passResults.push({ pass: r.pass, findings: r.findings, usage: r.usage, costUsd: r.costUsd, duration: r.duration });
    allFindings.push(...r.findings);
    if (r.summary) summaries.push(r.summary);
    if (r.updates) {
      mergedUpdates.new_concerns.push(...(r.updates.new_concerns ?? []));
      mergedUpdates.resolved_concerns.push(...(r.updates.resolved_concerns ?? []));
      mergedUpdates.architecture_changes.push(...(r.updates.architecture_changes ?? []));
    }
  }

  // Apply context updates to the persistent context and write updated CONTEXT.md.
  const updatedContext: PersistentContext = bundle.persistentContext
    ? applyContextUpdates(bundle.persistentContext, {
        newConcerns: mergedUpdates.new_concerns,
        resolvedConcerns: mergedUpdates.resolved_concerns,
        architectureChanges: mergedUpdates.architecture_changes,
      }, auditDate)
    : (bundle.persistentContext as unknown as PersistentContext);

  const cost: AuditCost = {
    totalUsd: tracker.getTotalCost(),
    perPass: Object.fromEntries(passResults.map((p) => [p.pass, p.costUsd])) as Record<DimensionPass, number>,
    inputTokens: passResults.reduce((s, p) => s + p.usage.inputTokens, 0),
    outputTokens: passResults.reduce((s, p) => s + p.usage.outputTokens, 0),
  };

  const auditResult: AuditResult = {
    repo: bundle.repo,
    date: auditDate,
    passes: passResults,
    staticFindings: bundle.staticAnalysis.topFindings,
    llmFindings: allFindings,
    cost,
    summary: summaries.join(" ") || "Audit completed with no narrative summary.",
    contextUpdated: bundle.persistentContext != null,
    bootstrapped: bundle.isBootstrap,
  };

  writeFileSync(findingsOut, JSON.stringify(allFindings, null, 2), "utf-8");
  writeFileSync(resultOut, JSON.stringify(auditResult, null, 2), "utf-8");
  if (updatedContext) writeFileSync(contextOut, generateContextMd(updatedContext), "utf-8");

  core.info(`Total: ${allFindings.length} LLM findings across ${passResults.length} passes. Cost: $${cost.totalUsd.toFixed(4)}.`);

  core.setOutput("findings-path", findingsOut);
  core.setOutput("audit-result-path", resultOut);
  core.setOutput("updated-context-path", contextOut);
  core.setOutput("total-findings", String(allFindings.length));
  core.setOutput("total-cost-usd", cost.totalUsd.toFixed(4));
  core.setOutput("summary", auditResult.summary);
}

// ── Single pass ────────────────────────────────────────────────────────

interface PassInput {
  pass: DimensionPass;
  bundle: ContextBundle;
  llm: Awaited<ReturnType<typeof createProvider>>;
  maxTokens: number;
}

interface PassOutput {
  pass: DimensionPass;
  findings: Finding[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  costUsd: number;
  duration: number;
  summary?: string;
  updates?: LlmJsonOutput["context_updates"];
}

async function runPass(input: PassInput): Promise<PassOutput | null> {
  const { pass, bundle, llm, maxTokens } = input;
  const systemPrompt = buildSystemPrompt(pass);
  const keyFiles = selectForPass(pass, bundle.keyFiles);

  const userMessage = buildUserMessage({
    repoName: bundle.repo,
    persistentContext: bundle.persistentContext ? summarizePersistent(bundle.persistentContext) : undefined,
    delta: bundle.delta ? summarizeDelta(bundle.delta) : undefined,
    fileStructure: bundle.fileStructure,
    keyFiles: keyFiles.map((f) => ({ path: f.path, content: f.content })),
    staticSummary: summarizeStatic(bundle),
  });

  const started = Date.now();
  try {
    const response = await llm.analyze({ systemPrompt, userMessage, maxOutputTokens: maxTokens });
    const duration = (Date.now() - started) / 1000;
    const parsed = parseLlmJson(response.content, pass);
    const findings = normalizeFindings(parsed.findings ?? [], pass);
    const costUsd = llm.estimateCost(response.usage);
    return {
      pass,
      findings,
      usage: response.usage,
      costUsd,
      duration,
      summary: parsed.summary,
      updates: parsed.context_updates,
    };
  } catch (e) {
    core.warning(`Pass '${pass}' failed: ${(e as Error).message}`);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function parsePasses(input: string): DimensionPass[] {
  const valid: DimensionPass[] = ["security", "quality", "documentation", "innovation"];
  return input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DimensionPass => (valid as string[]).includes(s));
}

/**
 * Filter bundle.keyFiles to those most relevant to the pass, using the
 * dimension's contextEmphasis signals. Files not matched stay if we have
 * few files overall — quality-first, don't starve the LLM of context.
 */
function selectForPass(pass: DimensionPass, files: KeyFile[]): KeyFile[] {
  if (files.length <= 20) return files; // small repo: send everything
  const emphasis = DIMENSION_PROMPTS[pass].contextEmphasis.map((e) => e.toLowerCase());
  const scored = files.map((f) => {
    const hay = `${f.path} ${f.reason}`.toLowerCase();
    const bonus = emphasis.reduce((sum, e) => sum + (hay.includes(e.split(" ")[0]) ? 15 : 0), 0);
    return { f, score: f.score + bonus };
  });
  scored.sort((a, b) => b.score - a.score);
  // Keep top 30 or everything above entry-point threshold, whichever is larger.
  const highThreshold = scored.filter((s) => s.score >= 80);
  const top = scored.slice(0, Math.max(30, highThreshold.length));
  return top.map((s) => s.f);
}

function summarizePersistent(ctx: PersistentContext): string {
  return generateContextMd(ctx);
}

function summarizeDelta(delta: ContextBundle["delta"]): string {
  if (!delta) return "";
  const parts: string[] = [];
  parts.push(`Since: ${delta.since}`);
  if (delta.newCommits.length) {
    parts.push(`### New commits (${delta.newCommits.length})`);
    for (const c of delta.newCommits.slice(0, 40)) parts.push(`- ${c.hash.slice(0, 8)} ${c.message}`);
  }
  if (delta.changedFiles.length) {
    parts.push(`### Changed files (${delta.changedFiles.length})`);
    for (const f of delta.changedFiles.slice(0, 60)) parts.push(`- [${f.status}] ${f.path}`);
  }
  if (delta.contextDrift.length) {
    parts.push(`### Context drift`);
    for (const d of delta.contextDrift) parts.push(`- ${d.type}: ${d.description}`);
  }
  return parts.join("\n");
}

function summarizeStatic(bundle: ContextBundle): string {
  const s = bundle.staticAnalysis;
  const lines = [`Total: ${s.total} (high=${s.bySeverity.high} medium=${s.bySeverity.medium} low=${s.bySeverity.low})`];
  lines.push(`By source: ${Object.entries(s.bySource).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  if (s.topFindings.length) {
    lines.push("Top findings:");
    for (const f of s.topFindings.slice(0, 10)) {
      lines.push(`- [${f.severity}] ${f.title}${f.file ? ` (${f.file}:${f.line ?? "?"})` : ""}`);
    }
  }
  return lines.join("\n");
}

function parseLlmJson(content: string, pass: DimensionPass): LlmJsonOutput {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");
  try {
    return JSON.parse(stripped) as LlmJsonOutput;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as LlmJsonOutput;
      } catch {}
    }
    core.warning(`Pass '${pass}' returned non-JSON content; discarding. First 200 chars: ${stripped.slice(0, 200)}`);
    return { findings: [] };
  }
}

function normalizeFindings(raw: LlmJsonOutput["findings"], pass: DimensionPass): Finding[] {
  const defaultDimension: Finding["dimension"] =
    pass === "security" ? "non_functional" :
    pass === "quality" ? "functional" :
    pass === "documentation" ? "documentation" :
    "feature_ideas";
  return raw.map((r, i) => ({
    id: `llm-${pass}-${i}`,
    source: "llm",
    dimension: (r.dimension as Finding["dimension"]) ?? defaultDimension,
    severity: r.severity,
    category: r.category,
    title: r.title,
    description: r.description,
    file: r.files_affected?.[0],
    recommendation: r.recommendation,
    references: r.references,
  }));
}

run().catch((err) => {
  core.setFailed((err as Error).message);
});
