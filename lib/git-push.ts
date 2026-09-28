/**
 * Authenticated git push, without a token in the remote URL.
 *
 * `https://x-access-token:${token}@github.com/...` puts the token in the
 * process argv (visible to any other process on the runner via `ps`) and in
 * the command string that `execFileSync`/`execSync` attach to a thrown Error
 * on failure — so a failed push can leak the token into action logs. A
 * GIT_ASKPASS helper keeps the token in an environment variable instead,
 * never on a command line.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createAskpassScript(token: string): { dir: string; scriptPath: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "rsi-askpass-"));
  const scriptPath = join(dir, "askpass.sh");
  writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s' "$RSI_GIT_TOKEN"\n`, "utf-8");
  chmodSync(scriptPath, 0o700);
  return {
    dir,
    scriptPath,
    env: { ...process.env, GIT_ASKPASS: scriptPath, GIT_TERMINAL_PROMPT: "0", RSI_GIT_TOKEN: token },
  };
}

export function pushWithToken(
  repoPath: string,
  owner: string,
  repoName: string,
  branch: string,
  token: string,
  remoteUrl: string = `https://github.com/${owner}/${repoName}.git`,
): void {
  const { dir, env } = createAskpassScript(token);
  try {
    execFileSync("git", ["-C", repoPath, "push", "--force", remoteUrl, branch], { stdio: "inherit", env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
