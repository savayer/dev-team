// Tests for hooks/sync-memory.mjs — run: node --test tests/sync-memory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'sync-memory.mjs');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();
const LEAD = 'dev-team-backend-lead';
const mem = (root) => join(root, '.claude/agent-memory-local', LEAD);

// main checkout + a task worktree, the way head-pm runs
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sync-'));
  const main = join(root, 'main');
  const wt = join(root, 'wt');
  execFileSync('git', ['init', '-q', main]);
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'team/a', wt);
  return { main, wt };
}

function run(cwd) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR; // frontmatter hooks can't rely on it
  return spawnSync('node', [HOOK], { input: JSON.stringify({ agent_type: LEAD, cwd }), env, encoding: 'utf8' });
}

test('copies what a lead learned in a worktree back to the main checkout', () => {
  const { main, wt } = setup();
  mkdirSync(mem(wt), { recursive: true });
  writeFileSync(join(mem(wt), 'MEMORY.md'), '- migrations run with npm run db:migrate\n');
  writeFileSync(join(mem(wt), 'auth.md'), 'tokens live in redis\n');
  const later = Date.now() / 1000 + 60; // written after the worktree's seed window
  utimesSync(join(mem(wt), 'auth.md'), later, later);
  const r = run(wt);
  assert.equal(r.stderr, '');
  assert.equal(readFileSync(join(mem(main), 'MEMORY.md'), 'utf8'), '- migrations run with npm run db:migrate\n');
  assert.equal(readFileSync(join(mem(main), 'auth.md'), 'utf8'), 'tokens live in redis\n');
});

test('does nothing in the main checkout itself', () => {
  const { main } = setup();
  mkdirSync(mem(main), { recursive: true });
  writeFileSync(join(mem(main), 'MEMORY.md'), '- a\n');
  run(main);
  assert.equal(readFileSync(join(mem(main), 'MEMORY.md'), 'utf8'), '- a\n');
});
