#!/usr/bin/env node
// WorktreeCreate hook of a multi-repo workspace (a non-git folder with several repos), set in the
// workspace's .claude/settings.json. The hook can't tell which repo an isolated agent is for, so it hands
// out an empty slot <workspace>/.team-worktrees/<name>; dev-team-head-pm turns it into a worktree of its
// repo with slot-init.mjs. Prints the slot's absolute path as the only stdout line; any failure exits 1.

import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

function fail(msg) {
  process.stderr.write(`worktree-slot: ${msg}\n`);
  process.exit(1);
}

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    fail(`cannot parse hook input (${e.message})`);
  }
  const ws = process.env.CLAUDE_PROJECT_DIR || data.cwd || '';
  if (typeof ws !== 'string' || !isAbsolute(ws)) fail(`the workspace must be an absolute path, got ${JSON.stringify(ws)}`);
  if (!statSync(ws, { throwIfNoEntry: false })?.isDirectory()) fail(`${ws} is not a folder`);
  try {
    execFileSync('git', ['-C', ws, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    fail('worktree-slot is only for a multi-repo workspace (a non-git folder)');
  } catch (e) {
    if (typeof e.status !== 'number') fail(`cannot run git (${e.message})`);
  }
  const { name } = data;
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') {
    fail(`bad worktree name ${JSON.stringify(name)}`);
  }
  const slot = join(ws, '.team-worktrees', name);
  try {
    const st = lstatSync(slot, { throwIfNoEntry: false });
    if (st && !st.isDirectory()) fail(`${slot} exists and is not a folder`);
    if (st && readdirSync(slot).length) fail(`${slot} exists and is not empty`);
    mkdirSync(slot, { recursive: true });
  } catch (e) {
    fail(`cannot create ${slot} (${e.message})`);
  }
  process.stdout.write(`${slot}\n`);
});
