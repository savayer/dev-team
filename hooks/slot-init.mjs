#!/usr/bin/env node
// Turns an empty slot from worktree-slot.mjs into a worktree of one repo of a multi-repo workspace.
// dev-team-head-pm runs it first, with the slot as its cwd:
//   node slot-init.mjs <repo-dir> <team/branch>
// <repo-dir>: a repo's top-level inside the workspace (the folder holding .team-worktrees/), absolute or
// relative to it. Fetches origin (pruned), puts the new branch on origin/develop, else on origin's default branch,
// copies the repo's .worktreeinclude matches the worktree lacks, and prints the base. Any failure exits 1.

import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

const OPT = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 1 << 28 };

function fail(msg) {
  process.stderr.write(`slot-init: ${msg}\n`);
  process.exit(1);
}

const raw = (...args) => execFileSync('git', args, OPT);
const ok = (...args) => {
  try {
    return raw(...args).trim();
  } catch {
    return null;
  }
};
const must = (what, ...args) => {
  try {
    return raw(...args);
  } catch (e) {
    fail(`${what} failed: ${String(e.stderr || e.message).trim()}`);
  }
};
const lstat = (p) => lstatSync(p, { throwIfNoEntry: false });

const args = process.argv.slice(2);
if (args.length !== 2) fail('usage: node slot-init.mjs <repo-dir> <team/branch>');
const [repoArg, branch] = args;

const slot = process.cwd();
if (basename(dirname(slot)) !== '.team-worktrees') fail(`${slot} is not a slot: run it in a folder right under .team-worktrees/`);
if (readdirSync(slot).length) fail(`the slot ${slot} is not empty`);
const ws = realpathSync(dirname(dirname(slot)));

let repo;
try {
  repo = realpathSync(resolve(ws, repoArg));
} catch {
  fail(`${repoArg} does not exist`);
}
if (!repo.startsWith(ws + sep)) fail(`${repo} is not inside the workspace ${ws}`);
const top = ok('-C', repo, 'rev-parse', '--show-toplevel');
if (top === null) fail(`${repo} is not a git repo`);
if (realpathSync(top) !== repo) fail(`${repo} is not a repo's top-level (that is ${top})`);

if (!branch.startsWith('team/')) fail(`the branch must start with team/, got "${branch}"`);
if (ok('check-ref-format', '--branch', branch) === null) fail(`not a valid branch name: "${branch}"`);

must('git fetch --prune origin', '-C', repo, 'fetch', '-q', '--prune', 'origin'); // a deleted origin/develop must not stay the base
for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
  if (ok('-C', repo, 'show-ref', '--verify', '--quiet', ref) !== null) fail(`branch ${branch} already exists (${ref})`);
}

let base = ok('-C', repo, 'rev-parse', '--verify', '-q', 'refs/remotes/origin/develop') === null ? '' : 'develop';
if (!base) {
  const head = ok('-C', repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD') ?? '';
  if (head.startsWith('origin/')) base = head.slice('origin/'.length);
}
if (!base) fail(`no origin/develop and no origin/HEAD in ${repo}: run \`git -C ${repo} remote set-head origin -a\` and retry`);

// --no-track: the branch gets its upstream from head-pm's first `git push -u`, as in a single-repo worktree
must('git worktree add', '-C', repo, 'worktree', 'add', '--no-track', '-b', branch, slot, `origin/${base}`);

// Claude Code applies .worktreeinclude only to worktrees it makes itself
const include = join(repo, '.worktreeinclude');
if (existsSync(include)) {
  try {
    const list = (...a) => raw(...a).split('\0').filter(Boolean);
    const tracked = new Set(list('-C', slot, 'ls-files', '-z'));
    for (const rel of list('-C', repo, 'ls-files', '-z', '--others', '--ignored', `--exclude-from=${include}`)) {
      if (tracked.has(rel) || !lstat(join(repo, rel))?.isFile()) continue; // tracked here, a symlink or not a file
      // a tracked symlink or file on the way would send the copy out of the slot
      const dirs = rel.split('/').slice(0, -1).map((_, i, parts) => join(slot, ...parts.slice(0, i + 1)));
      if (dirs.some((d) => lstat(d) && !lstat(d).isDirectory()) || lstat(join(slot, rel))) continue;
      mkdirSync(dirname(join(slot, rel)), { recursive: true });
      copyFileSync(join(repo, rel), join(slot, rel), constants.COPYFILE_EXCL);
    }
  } catch (e) {
    fail(`copying the .worktreeinclude files failed: ${String(e.stderr || e.message).trim()}`);
  }
}

process.stdout.write(`${base}\n`);
