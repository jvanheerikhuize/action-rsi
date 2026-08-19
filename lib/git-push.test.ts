import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAskpassScript, pushWithToken } from "./git-push.js";

describe("createAskpassScript", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes a script that prints the token from the environment, not an argument", () => {
    const result = createAskpassScript("s3cr3t-token");
    dir = result.dir;

    const output = execFileSync(result.scriptPath, [], {
      encoding: "utf-8",
      env: { ...process.env, RSI_GIT_TOKEN: "s3cr3t-token" },
    });
    expect(output).toBe("s3cr3t-token");

    const source = readFileSync(result.scriptPath, "utf-8");
    expect(source).not.toContain("s3cr3t-token");
  });

  it("restricts the script to the owner", () => {
    const result = createAskpassScript("token");
    dir = result.dir;
    const mode = statSync(result.scriptPath).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("sets GIT_ASKPASS and GIT_TERMINAL_PROMPT in the returned env", () => {
    const result = createAskpassScript("token");
    dir = result.dir;
    expect(result.env.GIT_ASKPASS).toBe(result.scriptPath);
    expect(result.env.GIT_TERMINAL_PROMPT).toBe("0");
  });
});

describe("pushWithToken", () => {
  let workDir: string;
  let bareDir: string;
  let repoPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "rsi-push-test-"));
    bareDir = join(workDir, "remote.git");
    repoPath = join(workDir, "repo");
    execFileSync("git", ["init", "--bare", bareDir]);
    execFileSync("git", ["init", repoPath]);
    execFileSync("git", ["-C", repoPath, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "init"]);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("pushes the branch to the given remote URL", () => {
    execFileSync("git", ["-C", repoPath, "checkout", "-b", "feature"]);

    pushWithToken(repoPath, "owner", "repo", "feature", "fake-token", `file://${bareDir}`);

    const branches = execFileSync("git", ["-C", bareDir, "branch", "--list"], { encoding: "utf-8" });
    expect(branches).toContain("feature");
  });

  it("does not embed the token in the remote URL it pushes to", () => {
    execFileSync("git", ["-C", repoPath, "checkout", "-b", "no-leak"]);
    pushWithToken(repoPath, "owner", "repo", "no-leak", "should-not-appear-anywhere", `file://${bareDir}`);

    const config = readFileSync(join(repoPath, ".git", "config"), "utf-8");
    expect(config).not.toContain("should-not-appear-anywhere");
  });
});
