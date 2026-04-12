/**
 * Cost tracker for audit runs.
 *
 * Tracks per-pass, per-repo, and total costs. Reports but never enforces
 * hard budget limits — cost informs, it doesn't dictate.
 */

import type { AuditCost, DimensionPass, PassResult, TokenUsage } from "./types.js";

export class CostTracker {
  private entries: CostEntry[] = [];

  record(repo: string, pass: DimensionPass, usage: TokenUsage, costUsd: number): void {
    this.entries.push({ repo, pass, usage, costUsd, timestamp: new Date().toISOString() });
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  getRepoCost(repo: string): AuditCost {
    const repoEntries = this.entries.filter((e) => e.repo === repo);
    const perPass: Record<string, number> = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let totalUsd = 0;

    for (const entry of repoEntries) {
      perPass[entry.pass] = (perPass[entry.pass] ?? 0) + entry.costUsd;
      inputTokens += entry.usage.inputTokens;
      outputTokens += entry.usage.outputTokens;
      totalUsd += entry.costUsd;
    }

    return {
      totalUsd,
      perPass: perPass as Record<DimensionPass, number>,
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Check if budget is approaching. Returns a warning string if > 80% used.
   * Never blocks — only informs.
   */
  budgetWarning(budgetUsd: number): string | null {
    const total = this.getTotalCost();
    const pct = (total / budgetUsd) * 100;
    if (pct > 100) {
      return `Budget exceeded: $${total.toFixed(4)} / $${budgetUsd} (${pct.toFixed(0)}%)`;
    }
    if (pct > 80) {
      return `Budget warning: $${total.toFixed(4)} / $${budgetUsd} (${pct.toFixed(0)}%)`;
    }
    return null;
  }

  getSummary(): CostSummary {
    const byRepo: Record<string, number> = {};
    const byPass: Record<string, number> = {};

    for (const entry of this.entries) {
      byRepo[entry.repo] = (byRepo[entry.repo] ?? 0) + entry.costUsd;
      byPass[entry.pass] = (byPass[entry.pass] ?? 0) + entry.costUsd;
    }

    return {
      totalUsd: this.getTotalCost(),
      totalCalls: this.entries.length,
      totalInputTokens: this.entries.reduce((s, e) => s + e.usage.inputTokens, 0),
      totalOutputTokens: this.entries.reduce((s, e) => s + e.usage.outputTokens, 0),
      byRepo,
      byPass,
      entries: [...this.entries],
    };
  }

  toPassResults(repo: string): PassResult[] {
    return this.entries
      .filter((e) => e.repo === repo)
      .map((e) => ({
        pass: e.pass,
        findings: [], // filled in by the caller
        usage: e.usage,
        costUsd: e.costUsd,
        duration: 0, // filled in by the caller
      }));
  }
}

interface CostEntry {
  repo: string;
  pass: DimensionPass;
  usage: TokenUsage;
  costUsd: number;
  timestamp: string;
}

export interface CostSummary {
  totalUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byRepo: Record<string, number>;
  byPass: Record<string, number>;
  entries: CostEntry[];
}
