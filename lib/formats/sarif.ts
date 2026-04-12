/**
 * SARIF output format.
 *
 * Minimal SARIF 2.1.0 generator for GitHub code scanning integration.
 * Converts Finding[] into a SARIF log that can be uploaded via the
 * `github/codeql-action/upload-sarif` action.
 */

import type { Finding, Severity } from "../types.js";

export function findingsToSarif(findings: Finding[], toolName = "RSI Audit"): string {
  const rules = new Map<string, { id: string; name: string; shortDescription: string }>();
  for (const f of findings) {
    const ruleId = `${f.source}/${f.category}`;
    if (!rules.has(ruleId)) {
      rules.set(ruleId, { id: ruleId, name: f.category, shortDescription: f.title });
    }
  }

  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: toolName,
          informationUri: "https://github.com/jerryvanheerikhuize/action-rsi",
          rules: Array.from(rules.values()).map((r) => ({
            id: r.id,
            name: r.name,
            shortDescription: { text: r.shortDescription },
          })),
        },
      },
      results: findings.map((f) => ({
        ruleId: `${f.source}/${f.category}`,
        level: mapSeverity(f.severity),
        message: { text: `${f.title}\n\n${f.description}` },
        locations: f.file ? [{
          physicalLocation: {
            artifactLocation: { uri: f.file },
            region: f.line ? { startLine: f.line, endLine: f.endLine ?? f.line } : undefined,
          },
        }] : [],
      })),
    }],
  };

  return JSON.stringify(sarif, null, 2);
}

function mapSeverity(s: Severity): "error" | "warning" | "note" {
  if (s === "high") return "error";
  if (s === "medium") return "warning";
  return "note";
}
