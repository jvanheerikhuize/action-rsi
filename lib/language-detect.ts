/**
 * Language detection.
 *
 * Detects languages in a repository by file extension distribution.
 * The static analyzer mapping lives in lib/analyzers/runners.ts.
 */

import type { LanguageProfile } from "./types.js";

const EXTENSION_MAP: Record<string, string> = {
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".py": "python", ".pyw": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".tsx": "typescript", ".jsx": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".php": "php",
  ".lua": "lua",
  ".zig": "zig",
  ".yaml": "yaml", ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".md": "markdown",
  ".html": "html", ".htm": "html",
  ".css": "css", ".scss": "css",
  ".sql": "sql",
  ".dockerfile": "docker",
};

const ENTRY_POINT_PATTERNS: Record<string, string[]> = {
  shell: ["main.sh", "install.sh", "setup.sh", "entrypoint.sh", "run.sh"],
  python: ["main.py", "app.py", "setup.py", "__main__.py", "manage.py", "wsgi.py"],
  javascript: ["index.js", "app.js", "server.js", "main.js"],
  typescript: ["index.ts", "app.ts", "server.ts", "main.ts"],
  go: ["main.go", "cmd/main.go"],
  rust: ["main.rs", "lib.rs"],
  ruby: ["app.rb", "config.ru", "Rakefile"],
  java: ["Main.java", "Application.java"],
};

/**
 * Detect languages in a repository from a list of file paths.
 */
export function detectLanguages(filePaths: string[]): LanguageProfile[] {
  const counts: Record<string, { files: number; paths: string[] }> = {};
  let totalSource = 0;

  for (const filePath of filePaths) {
    const ext = getExtension(filePath);
    const lang = EXTENSION_MAP[ext];
    if (!lang || lang === "markdown" || lang === "json" || lang === "yaml" || lang === "toml") continue;

    totalSource++;
    if (!counts[lang]) counts[lang] = { files: 0, paths: [] };
    counts[lang].files++;
    counts[lang].paths.push(filePath);
  }

  if (totalSource === 0) return [];

  return Object.entries(counts)
    .map(([language, data]) => ({
      language,
      percentage: Math.round((data.files / totalSource) * 100),
      fileCount: data.files,
      entryPoints: findEntryPoints(language, data.paths),
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

function findEntryPoints(language: string, filePaths: string[]): string[] {
  const patterns = ENTRY_POINT_PATTERNS[language] ?? [];
  return filePaths.filter((p) => {
    const basename = p.split("/").pop() ?? "";
    return patterns.some((pattern) => basename === pattern || p.endsWith(pattern));
  });
}

function getExtension(filePath: string): string {
  const basename = filePath.split("/").pop() ?? "";
  if (basename === "Dockerfile" || basename.startsWith("Dockerfile.")) return ".dockerfile";
  if (basename === "Makefile") return ""; // not a source language
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex === -1) return "";
  return basename.slice(dotIndex).toLowerCase();
}
