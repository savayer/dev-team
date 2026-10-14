#!/usr/bin/env node
// Merge mode's base for a checkout: the TEAM_MERGE_BRANCH that applies to it, '' when merge mode is off.
// One resolver for guard.mjs, dev-team-head-pm (step 13) and the /team dispatcher:
//   node merge-branch.mjs               for the current folder
//   node merge-branch.mjs --repo <dir>  for a repo of a multi-repo workspace
// Multi-repo (a worktree right under .team-worktrees/, or --repo): only the repo's own
// <main checkout>/.claude/settings.local.json → env.TEAM_MERGE_BRANCH counts; the session env belongs
// to the workspace and is ignored. Single repo: the env, which Claude Code fills from the project settings.
// Prints the value or nothing. Validation stays with the guard.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();

function repoSetting(dir) {
  try {
    const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'); // <main>/.git
    if (basename(common) !== '.git') return '';
    const value = JSON.parse(readFileSync(join(dirname(common), '.claude', 'settings.local.json'), 'utf8'))?.env?.TEAM_MERGE_BRANCH;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function mergeBranch({ cwd, repo, env = process.env } = {}) {
  if (repo) return repoSetting(repo);
  let top = '';
  try {
    if (cwd) top = git(cwd, 'rev-parse', '--show-toplevel'); // `git -C ''` would mean this process's folder
  } catch {}
  if (top && basename(dirname(top)) === '.team-worktrees') return repoSetting(cwd);
  return env.TEAM_MERGE_BRANCH ?? '';
}

let main = false;
try {
  main = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {}
if (main) {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--repo' && args[1]))) {
    process.stderr.write('usage: node merge-branch.mjs [--repo <repo-dir>]\n');
    process.exit(1);
  }
  const value = args.length ? mergeBranch({ repo: args[1] }) : mergeBranch({ cwd: process.cwd() });
  if (value) process.stdout.write(`${value}\n`);
}
