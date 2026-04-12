import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DimensionPass } from "../types.js";

const PASS_TO_ROLE: Record<DimensionPass, { category: string; slug: string }> = {
  security: { category: "engineering", slug: "sentry" },
  quality: { category: "engineering", slug: "probe" },
  documentation: { category: "engineering", slug: "guide" },
  innovation: { category: "engineering", slug: "spark" },
};

export interface RoleDefinition {
  slug: string;
  prompt: string;
  contextEmphasis: string[];
}

const cache = new Map<string, RoleDefinition>();

export function resolveRolesPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  if (process.env.GITHUB_ACTION_PATH) {
    return resolve(process.env.GITHUB_ACTION_PATH, "submodules/agent-roledefinitions");
  }
  const thisDir = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "../../submodules/agent-roledefinitions");
}

export function loadRole(pass: DimensionPass, rolesBasePath: string): RoleDefinition | null {
  const cacheKey = `${rolesBasePath}:${pass}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const role = PASS_TO_ROLE[pass];
  if (!role) return null;

  const promptPath = resolve(rolesBasePath, `roles/${role.category}/${role.slug}/prompt.md`);
  if (!existsSync(promptPath)) return null;

  const raw = readFileSync(promptPath, "utf-8");
  const prompt = extractPromptContent(raw);
  const contextEmphasis = extractContextEmphasis(raw);

  const def: RoleDefinition = { slug: role.slug, prompt, contextEmphasis };
  cache.set(cacheKey, def);
  return def;
}

export function rolesAvailable(rolesBasePath: string): boolean {
  return existsSync(resolve(rolesBasePath, "index.yaml"));
}

function extractPromptContent(md: string): string {
  const match = md.match(/```text\s*\n([\s\S]*?)```/);
  return match ? match[1].trim() : md;
}

function extractContextEmphasis(md: string): string[] {
  const match = md.match(/<CONTEXT_EMPHASIS>([\s\S]*?)<\/CONTEXT_EMPHASIS>/);
  if (!match) return [];
  return match[1]
    .replace(/Prioritise review of:/i, "")
    .split(",")
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
}
