// Tests for .claude/hooks/guard-push.mjs — run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'guard-push.mjs');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();

// origin (bare, default develop) ← clone `work` on team/a, one commit ahead of develop, pushed
export function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'guard-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', origin]);
  execFileSync('git', ['clone', '-q', origin, work], { env: GIT_ENV, stdio: 'ignore' });
  git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'HEAD:develop');
  git(work, 'checkout', '-q', '-b', 'team/a');
  writeFileSync(join(work, 'a.txt'), 'a\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'a');
  git(work, 'push', '-q', '-u', 'origin', 'team/a');
  return { root, origin, work, sha: git(work, 'rev-parse', 'HEAD'), git: (...a) => git(work, ...a) };
}

// fake gh first on PATH: answers `pr view` / `pr diff` from env, fails on FAKE_GH_FAIL
export const BIN = mkdtempSync(join(tmpdir(), 'fakegh-'));
writeFileSync(join(BIN, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
if (process.env.FAKE_GH_FAIL) { process.stderr.write('boom'); process.exit(1); }
if (a.startsWith('pr view')) process.stdout.write(process.env.FAKE_PR_JSON ?? '{}');
else if (a.startsWith('pr diff')) process.stdout.write(process.env.FAKE_PR_FILES ?? '');
else process.exit(1);
`);
chmodSync(join(BIN, 'gh'), 0o755);

export function runHook(command, agent_type, { cwd, env = {} } = {}) {
  const base = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  delete base.TEAM_MERGE_BRANCH;
  const r = spawnSync('node', [HOOK], {
    cwd: cwd ?? process.cwd(),
    input: JSON.stringify({ tool_input: { command }, agent_type, cwd: cwd ?? '' }),
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const repo = makeRepo();

test('existing forms keep their behaviour', () => {
  const cases = [
    ['git push -u origin team/a', 'head-pm', 0],
    ['git push -u origin team/b', 'head-pm', 2],
    ['git push -u origin team/a', 'backend-lead', 2],
    ['gh pr create --base develop --title t --body-file .team/pr-body.md', 'head-pm', 0],
    ['gh pr create --title t', 'backend-lead', 2],
    ['gh pr view 1 --json state', 'claude', 0],
    ['gh repo view --json defaultBranchRef -q .defaultBranchRef.name', 'head-pm', 0],
    ['git status --porcelain', 'claude', 0],
    ['echo high and github', 'claude', 0],
  ];
  for (const [cmd, agent, want] of cases) assert.equal(runHook(cmd, agent, { cwd: repo.work }).status, want, cmd);
});

test('gh behind wrappers, prefixes and new lines is denied', () => {
  const cases = [
    'command gh pr merge 7 --admin',
    'timeout 5 gh pr merge 7 --merge',
    'env GH_REPO=o/r gh pr merge 7 --merge',
    'GH_REPO=o/r gh pr merge 7 --merge',
    'true\ngh pr merge 7 --merge',
    '$(which gh) pr merge 7 --merge',
    '{ gh pr merge 7 --merge; }',
    'if gh pr merge 7 --merge; then :; fi',
    'nohup gh api repos/o/r/merges',
    'command gh pr create --help',
  ];
  for (const cmd of cases) assert.equal(runHook(cmd, 'head-pm', { cwd: repo.work }).status, 2, cmd);
});

test('documented false positives: the word gh in text is blocked', () => {
  assert.equal(runHook("printf '%s' 'gh pr list'", 'claude', { cwd: repo.work }).status, 2);
  assert.equal(runHook('git commit -m "fix gh link"', 'head-pm', { cwd: repo.work }).status, 2);
});
