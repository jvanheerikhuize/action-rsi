/**
 * Cost tracker for audit runs.
 *
 * Tracks per-pass cost and token usage. Reports but never enforces
 * hard budget limits — cost informs, it doesn't dictate.
 */

import type { DimensionPass, TokenUsage } from "./types.js";

interface CostEntry {
  repo: string;
  pass: DimensionPass;
  usage: TokenUsage;
  costUsd: number;
}

export class CostTracker {
  private entries: CostEntry[] = [];

  record(repo: string, pass: DimensionPass, usage: TokenUsage, costUsd: number): void {
    this.entries.push({ repo, pass, usage, costUsd });
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }
}
