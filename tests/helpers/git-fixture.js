import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// All repositories/worktrees are disposable fixtures, never registered projects.
export function gitFixture(t, { committed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "main");
  fs.mkdirSync(repo);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull,
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    GIT_TERMINAL_PROMPT: "0"
  });
  const git = (args, cwd = repo) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }).trim();
  git(["init", "--initial-branch=main"]);
  const write = (file, contents, cwd = repo) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), contents);
  };
  const commit = (message = "fixture", cwd = repo) => {
    git(["add", "."], cwd);
    git(["commit", "--no-gpg-sign", "-m", message], cwd);
    return git(["rev-parse", "HEAD"], cwd);
  };
  if (committed) {
    write("package.json", '{"name":"fixture"}\n');
    write("src/source.ts", "export const original = 1;\n");
    commit();
  }
  const worktree = (name = "linked") => {
    const location = path.join(root, name);
    git(["worktree", "add", "--detach", location]);
    return location;
  };
  return { root, repo, git, write, commit, worktree, project: { name: "fixture", projectId: "PrJ_Fixture", absolutePath: repo } };
}
