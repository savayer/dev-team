// Tests for hooks/worktree-slot.mjs — run: node --test tests/worktree-slot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'worktree-slot.mjs');
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'slot-')));

function run({ cwd, name = 'agent-a1b2', projectDir } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  const input = JSON.stringify({ hook_event_name: 'WorktreeCreate', session_id: 's', cwd, name });
  return spawnSync('node', [HOOK], { cwd: tmpdir(), input, env, encoding: 'utf8' });
}

test('creates an empty slot and prints only its absolute path', () => {
  const ws = temp();
  const r = run({ cwd: ws });
  assert.equal(r.status, 0, r.stderr);
  const slot = join(ws, '.team-worktrees', 'agent-a1b2');
  assert.equal(r.stdout, `${slot}\n`);
  assert.deepEqual(readdirSync(slot), []);
  assert.equal(run({ cwd: ws }).status, 0, 'an existing empty slot is reused');
});

test('CLAUDE_PROJECT_DIR wins over the stdin cwd', () => {
  const ws = temp();
  const other = temp();
  const r = run({ cwd: other, projectDir: ws });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${join(ws, '.team-worktrees', 'agent-a1b2')}\n`);
  assert.equal(existsSync(join(other, '.team-worktrees')), false);
});

test('a non-empty slot is refused and left alone', () => {
  const ws = temp();
  const slot = join(ws, '.team-worktrees', 'agent-a1b2');
  mkdirSync(slot, { recursive: true });
  writeFileSync(join(slot, 'work.txt'), 'x\n');
  const r = run({ cwd: ws });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not empty/);
  assert.equal(readFileSync(join(slot, 'work.txt'), 'utf8'), 'x\n');
});

test('a file in place of the slot is refused', () => {
  const ws = temp();
  mkdirSync(join(ws, '.team-worktrees'));
  writeFileSync(join(ws, '.team-worktrees', 'agent-a1b2'), 'x\n');
  const r = run({ cwd: ws });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, '');
});

test('bad names and a relative workspace are refused, nothing is created', () => {
  const ws = temp();
  for (const name of ['', '.', '..', 'a/b', '../x', 'a b', 'x\n', 'x'.repeat(101), null, 7]) {
    const r = run({ cwd: ws, name });
    assert.notEqual(r.status, 0, JSON.stringify(name));
    assert.equal(r.stdout, '', JSON.stringify(name));
  }
  assert.equal(existsSync(join(ws, '.team-worktrees')), false);
  assert.equal(run({ cwd: ws, name: 'x'.repeat(100) }).status, 0, '100 chars is fine');
  for (const cwd of ['ws', '', undefined]) assert.notEqual(run({ cwd }).status, 0, `cwd ${cwd}`);
});

test('a workspace inside a git repo is refused', () => {
  const repo = temp();
  execFileSync('git', ['init', '-q', repo]);
  mkdirSync(join(repo, 'sub'));
  for (const ws of [repo, join(repo, 'sub')]) {
    const r = run({ cwd: ws });
    assert.notEqual(r.status, 0, ws);
    assert.match(r.stderr, /only for a multi-repo workspace \(a non-git folder\)/, ws);
    assert.equal(existsSync(join(ws, '.team-worktrees')), false, ws);
  }
});

test('.team-worktrees that is a symlink or a file is refused, nothing is created outside', () => {
  const ws = temp();
  const outside = temp();
  symlinkSync(outside, join(ws, '.team-worktrees'));
  const r = run({ cwd: ws });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.deepEqual(readdirSync(outside), []);
  const ws2 = temp();
  writeFileSync(join(ws2, '.team-worktrees'), 'x\n');
  assert.equal(run({ cwd: ws2 }).status, 1);
});
