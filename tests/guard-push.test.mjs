// Tests for .claude/hooks/guard-push.mjs — run: node --test tests/guard-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUARD_HOOK points the suite at a mutated copy (mutation checks)
const HOOK = process.env.GUARD_HOOK ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'guard-push.mjs');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();

function writeFiles(dir, files) {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
}

// origin (bare, default develop; `base` files committed there) ← clone `work` on team/a:
// `mv` renames and `team` files written in one commit on top of develop, pushed
export function makeRepo({ base = {}, team = { 'a.txt': 'a\n' }, mv } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guard-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', origin]);
  execFileSync('git', ['clone', '-q', origin, work], { env: GIT_ENV, stdio: 'ignore' });
  writeFiles(work, base);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'HEAD:develop');
  git(work, 'checkout', '-q', '-b', 'team/a');
  if (mv) {
    mkdirSync(dirname(join(work, mv[1])), { recursive: true });
    git(work, 'mv', mv[0], mv[1]);
  }
  writeFiles(work, team);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'a');
  git(work, 'push', '-q', '-u', 'origin', 'team/a');
  return { root, origin, work, sha: git(work, 'rev-parse', 'HEAD') };
}

// fake gh first on PATH: answers `pr view` from env, fails on FAKE_GH_FAIL
export const BIN = mkdtempSync(join(tmpdir(), 'fakegh-'));
writeFileSync(join(BIN, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
if (process.env.FAKE_GH_FAIL) { process.stderr.write('boom'); process.exit(1); }
if (a.startsWith('pr view')) process.stdout.write(process.env.FAKE_PR_JSON ?? '{}');
else process.exit(1);
`);
chmodSync(join(BIN, 'gh'), 0o755);

export function runHook(command, agent_type, { cwd, env = {} } = {}) {
  const base = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  for (const k of ['TEAM_MERGE_BRANCH', 'GH_REPO', 'GH_HOST']) delete base[k];
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

const prJson = (r, over = {}) => JSON.stringify({ state: 'OPEN', baseRefName: 'develop', headRefName: 'team/a', headRefOid: r.sha, isCrossRepository: false, ...over });
const mergeCmd = (r, branch = 'team/a', sha = r.sha) => `gh pr merge ${branch} --merge --match-head-commit ${sha}`;
const env = (r, over = {}) => ({ TEAM_MERGE_BRANCH: 'develop', FAKE_PR_JSON: prJson(r), ...over });

// each denial must come from the check its name says, not from a later one
function denied(r, cmd, agent, over, reason, name) {
  const e = env(r, over);
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const res = runHook(cmd, agent, { cwd: r.work, env: e });
  assert.equal(res.status, 2, name);
  assert.match(res.stderr, reason, name);
}

test('merge: the exact form passes when every check holds', () => {
  const r = runHook(mergeCmd(repo), 'head-pm', { cwd: repo.work, env: env(repo) });
  assert.equal(r.status, 0, r.stderr);
});

test('merge: switch, environment, agent, branch and commit checks', () => {
  const cases = [
    ['switch unset', mergeCmd(repo), 'head-pm', { TEAM_MERGE_BRANCH: undefined }, /merge mode is off/],
    ['switch empty', mergeCmd(repo), 'head-pm', { TEAM_MERGE_BRANCH: '' }, /merge mode is off/],
    ['switch starts with -', mergeCmd(repo), 'head-pm', { TEAM_MERGE_BRANCH: '-x' }, /must not start with -/],
    ['switch invalid ref', mergeCmd(repo), 'head-pm', { TEAM_MERGE_BRANCH: 'a..b' }, /not a valid branch name/],
    ['switch with spaces', mergeCmd(repo), 'head-pm', { TEAM_MERGE_BRANCH: ' develop' }, /not a valid branch name/],
    ['GH_REPO set', mergeCmd(repo), 'head-pm', { GH_REPO: 'o/r' }, /GH_REPO is set/],
    ['GH_HOST set', mergeCmd(repo), 'head-pm', { GH_HOST: 'example.com' }, /GH_HOST is set/],
    ['not head-pm', mergeCmd(repo), 'backend-lead', {}, /only head-pm may merge/],
    ['other branch', mergeCmd(repo, 'team/b'), 'head-pm', {}, /merge only your current branch/],
    ['sha is not HEAD', mergeCmd(repo, 'team/a', '0'.repeat(40)), 'head-pm', {}, /must be your HEAD/],
  ];
  for (const [name, cmd, agent, over, reason] of cases) denied(repo, cmd, agent, over, reason, name);
});

test('merge: PR state checks', () => {
  const cases = [
    ['not open', { state: 'MERGED' }, /not OPEN/],
    ['other head branch', { headRefName: 'team/b' }, /push first/],
    ['head moved', { headRefOid: '1'.repeat(40) }, /push first/],
    ['fork', { isCrossRepository: true }, /fork/],
    ['other base', { baseRefName: 'main' }, /merge mode allows only develop/],
  ];
  for (const [name, over, reason] of cases) denied(repo, mergeCmd(repo), 'head-pm', { FAKE_PR_JSON: prJson(repo, over) }, reason, name);
  denied(repo, mergeCmd(repo), 'head-pm', { FAKE_PR_JSON: 'not json' }, /merge check failed/, 'bad json');
  denied(repo, mergeCmd(repo), 'head-pm', { FAKE_GH_FAIL: '1' }, /merge check failed/, 'gh fails');
});

test('merge: protected paths in the real diff are never auto-merged', () => {
  const many = Object.fromEntries(Array.from({ length: 149 }, (_, i) => [`src/f${i}.ts`, 'x\n']));
  for (const p of ['.claude/settings.json', '.github/workflows/ci.yml', '.husky/pre-commit', '.mcp.json', '.worktreeinclude', '.claude/ünï code.md']) {
    const r = makeRepo({ team: { ...many, [p]: 'x\n' } });
    denied(r, mergeCmd(r), 'head-pm', {}, /touches/, p);
  }
  for (const [from, to] of [['.husky/pre-commit', 'scripts/pre-commit'], ['.claude/hooks/guard-push.mjs', 'src/guard-push.mjs']]) {
    const r = makeRepo({ base: { [from]: 'x\n' }, team: {}, mv: [from, to] });
    denied(r, mergeCmd(r), 'head-pm', {}, /touches/, `moved out: ${from}`);
  }
  const ok = makeRepo({ team: { 'src/.claude-notes.md': 'x\n', 'docs/a.md': 'x\n' } });
  const res = runHook(mergeCmd(ok), 'head-pm', { cwd: ok.work, env: env(ok) });
  assert.equal(res.status, 0, res.stderr);
});

test('merge: other forms and flags are denied', () => {
  const s = repo.sha;
  const cases = [
    'gh pr merge 7 --merge',
    'gh pr merge https://github.com/o/r/pull/7 --merge',
    `gh pr merge team/a --merge --match-head-commit ${s} --admin`,
    `gh pr merge team/a --merge --match-head-commit ${s} --delete-branch`,
    `gh pr merge team/a --squash --match-head-commit ${s}`,
    `gh pr merge team/a --rebase --match-head-commit ${s}`,
    `gh pr merge team/a --auto --merge --match-head-commit ${s}`,
    `gh pr merge team/a --merge --match-head-commit ${s} -R o/r`,
    `gh pr merge team/a --merge`,
    `gh pr merge team/a --merge --match-head-commit ${s} # done`,
    `gh pr merge team/a  --merge --match-head-commit ${s}`,
    `gh pr merge team/a --merge --match-head-commit ${s}; true`,
    `command gh pr merge team/a --merge --match-head-commit ${s}`,
  ];
  for (const cmd of cases) denied(repo, cmd, 'head-pm', {}, /allowed forms are/, cmd);
});

test('merge: dirty tree is denied', () => {
  const r = makeRepo();
  writeFileSync(join(r.work, 'a.txt'), 'changed\n');
  denied(r, mergeCmd(r), 'head-pm', {}, /tracked changes/, 'dirty');
});

test('merge: base moved since the branch caught up → denied with "base moved"', () => {
  const r = makeRepo();
  const other = join(r.root, 'other');
  execFileSync('git', ['clone', '-q', '-b', 'develop', r.origin, other], { env: GIT_ENV, stdio: 'ignore' });
  git(other, 'commit', '-q', '--allow-empty', '-m', 'someone else merged');
  git(other, 'push', '-q', 'origin', 'develop');
  denied(r, mergeCmd(r), 'head-pm', {}, /base moved/, 'base moved');
});
