// Tests for hooks/slot-init.mjs — run: node --test tests/slot-init.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'slot-init.mjs');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function writeFiles(dir, files) {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
}

// bare origin (HEAD → `head`) with `head`, and `develop` one commit ahead with `devFiles`;
// the workspace clone <ws>/app; `seed` pushes more to origin later; an empty slot <ws>/.team-worktrees/agent-1
function setup({ head = 'main', develop = true, devFiles = {}, onDevelop } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'slotinit-')));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const ws = join(root, 'ws');
  const repo = join(ws, 'app');
  execFileSync('git', ['init', '-q', '--bare', '-b', head, origin]);
  execFileSync('git', ['init', '-q', '-b', head, seed]);
  git(seed, 'remote', 'add', 'origin', origin);
  writeFiles(seed, { 'README.md': 'app\n' });
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'push', '-q', 'origin', head);
  if (develop) {
    git(seed, 'checkout', '-q', '-b', 'develop');
    writeFiles(seed, devFiles);
    onDevelop?.(seed, root);
    git(seed, 'add', '-A');
    git(seed, 'commit', '-q', '--allow-empty', '-m', 'dev');
    git(seed, 'push', '-q', 'origin', 'develop');
  }
  mkdirSync(ws);
  execFileSync('git', ['clone', '-q', origin, repo], { env: GIT_ENV, stdio: 'ignore' });
  const slot = join(ws, '.team-worktrees', 'agent-1');
  mkdirSync(slot, { recursive: true });
  return { root, origin, seed, ws, repo, slot };
}

// a commit the workspace clone hasn't fetched yet
function pushLater(seed, branch) {
  git(seed, 'checkout', '-q', branch);
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'later');
  git(seed, 'push', '-q', 'origin', branch);
  return git(seed, 'rev-parse', 'HEAD');
}

function run(cwd, ...args) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.TEAM_MERGE_BRANCH;
  return spawnSync('node', [HOOK, ...args], { cwd, env, encoding: 'utf8' });
}

const hasBranch = (repo, b) => spawnSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${b}`]).status === 0;

function refused(s, cwd, args, reason, name) {
  const r = run(cwd, ...args);
  assert.notEqual(r.status, 0, name);
  assert.equal(r.stdout, '', name);
  assert.match(r.stderr, reason, name);
  assert.deepEqual(readdirSync(s.slot), [], name);
  assert.equal(hasBranch(s.repo, 'team/x'), false, name);
}

test('develop base: the slot becomes a worktree of the repo on a new branch at the fetched origin/develop', () => {
  const s = setup();
  const dev = pushLater(s.seed, 'develop');
  writeFiles(s.repo, { '.env': 'secret\n' });
  const r = run(s.slot, 'app', 'team/x');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'develop\n');
  assert.equal(git(s.slot, 'branch', '--show-current'), 'team/x');
  assert.equal(git(s.slot, 'rev-parse', 'HEAD'), dev);
  assert.equal(realpathSync(git(s.slot, 'rev-parse', '--show-toplevel')), s.slot);
  assert.equal(git(s.slot, 'rev-parse', '--path-format=absolute', '--git-common-dir'), join(s.repo, '.git'));
  assert.throws(() => git(s.slot, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'the branch does not track the base');
  assert.equal(git(s.slot, 'status', '--porcelain'), '', 'no .worktreeinclude: nothing copied');
});

test('no develop: the default branch from origin/HEAD', () => {
  const s = setup({ head: 'trunk', develop: false });
  const tip = pushLater(s.seed, 'trunk');
  const r = run(s.slot, s.repo, 'team/x');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'trunk\n');
  assert.equal(git(s.slot, 'rev-parse', 'HEAD'), tip);
});

test('no develop and no origin/HEAD: refused with a hint', () => {
  const s = setup({ develop: false });
  git(s.repo, 'remote', 'set-head', 'origin', '-d');
  git(s.repo, 'config', 'remote.origin.followRemoteHEAD', 'never'); // git 2.48+ fetch would restore origin/HEAD
  refused(s, s.slot, ['app', 'team/x'], /remote set-head origin -a/, 'no base');
});

test('the cwd must be an empty folder right under .team-worktrees', () => {
  const s = setup();
  writeFiles(s.slot, { 'x.txt': 'x\n' });
  const r = run(s.slot, 'app', 'team/x');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /empty/);
  assert.equal(hasBranch(s.repo, 'team/x'), false);
  for (const dir of [join(s.ws, 'slots', 'agent-2'), join(s.ws, '.team-worktrees', 'a', 'b')]) {
    mkdirSync(dir, { recursive: true });
    assert.notEqual(run(dir, 'app', 'team/x').status, 0, dir);
    assert.equal(hasBranch(s.repo, 'team/x'), false, dir);
  }
});

test('the repo must be a git top-level inside the workspace', () => {
  const s = setup();
  const outside = join(s.root, 'outside');
  execFileSync('git', ['clone', '-q', s.origin, outside], { stdio: 'ignore' });
  symlinkSync(outside, join(s.ws, 'link'));
  mkdirSync(join(s.repo, 'sub'));
  mkdirSync(join(s.ws, 'plain'));
  const cases = [
    [outside, /inside the workspace/],
    ['../outside', /inside the workspace/],
    ['link', /inside the workspace/],
    ['app/sub', /top-level/],
    ['plain', /not a git repo/],
    ['nope', /does not exist/],
    ['.', /inside the workspace/],
  ];
  for (const [repo, reason] of cases) refused(s, s.slot, [repo, 'team/x'], reason, repo);
});

test('the branch must be a new, valid team/* branch', () => {
  const s = setup();
  git(s.repo, 'branch', 'team/taken');
  git(s.seed, 'push', '-q', 'origin', 'HEAD:refs/heads/team/remote');
  const cases = [
    [['app'], /usage/],
    [['app', 'feature/x'], /team\//],
    [['app', 'team/'], /not a valid branch name/],
    [['app', 'team/a..b'], /not a valid branch name/],
    [['app', 'team/x.lock'], /not a valid branch name/],
    [['app', 'team/a b'], /not a valid branch name/],
    [['app', '-b'], /team\//],
    [['app', 'team/taken'], /already exists/],
    [['app', 'team/remote'], /already exists/],
    [['app', 'team/x', 'extra'], /usage/],
  ];
  for (const [args, reason] of cases) refused(s, s.slot, args, reason, args.join(' '));
});

test('.worktreeinclude: copies untracked matches, never overwrites, skips tracked paths and symlinks', () => {
  const s = setup({
    devFiles: { 'config.json': 'develop\n' },
    onDevelop: (seed, root) => {
      mkdirSync(join(root, 'elsewhere'));
      symlinkSync(join(root, 'elsewhere'), join(seed, 'linked')); // tracked symlink to a folder outside
    },
  });
  // a post-checkout hook writes hook.local into the new worktree before the copy
  const hooks = join(s.root, 'hooks');
  writeFiles(hooks, { 'post-checkout': '#!/bin/sh\necho hook > hook.local\n' });
  chmodSync(join(hooks, 'post-checkout'), 0o755);
  git(s.repo, 'config', 'core.hooksPath', hooks);
  writeFiles(s.repo, {
    '.worktreeinclude': '.env\nconfig.json\n*.local\nlocal/\n',
    '.env': 'secret\n',
    'local/deep/a.txt': 'a\n',
    'config.json': 'main checkout\n',
    'hook.local': 'main checkout\n',
    'linked/x.local': 'x\n',
    'other.txt': 'not listed\n',
  });
  symlinkSync('.env', join(s.repo, 'link.local'));
  const r = run(s.slot, 'app', 'team/x');
  assert.equal(r.status, 0, r.stderr);
  const read = (p) => readFileSync(join(s.slot, p), 'utf8');
  assert.equal(read('.env'), 'secret\n');
  assert.equal(read('local/deep/a.txt'), 'a\n');
  assert.equal(read('config.json'), 'develop\n', 'tracked in the worktree');
  assert.equal(read('hook.local'), 'hook\n', 'never overwritten');
  assert.equal(lstatSync(join(s.slot, 'link.local'), { throwIfNoEntry: false }), undefined, 'symlinks skipped');
  assert.equal(existsSync(join(s.slot, 'other.txt')), false);
  assert.deepEqual(readdirSync(join(s.root, 'elsewhere')), [], 'nothing written through a tracked symlink');
  assert.equal(git(s.slot, 'diff', '--name-only', 'HEAD'), '');
});
