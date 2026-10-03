#!/usr/bin/env node
// SubagentStop for leads: copy the lead's local memory from its task worktree back
// to the main checkout ($CLAUDE_PROJECT_DIR), which seeds the next worktree via .worktreeinclude.
// Never blocks: always exits 0, problems go to stderr.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const { agent_type: agent, cwd } = JSON.parse(input);
    const main = process.env.CLAUDE_PROJECT_DIR;
    if (!agent || !cwd || !main) return;
    const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (resolve(root) === resolve(main)) return;
    const from = join(root, '.claude/agent-memory-local', agent);
    if (!existsSync(from)) return;
    // .worktreeinclude seeds memory when the worktree is created and doesn't keep mtimes:
    // a file not written after that is a stale seed, not something this lead learned
    const seeded = statSync(join(root, '.git')).mtimeMs + 10_000;
    const to = join(main, '.claude/agent-memory-local', agent);
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      const src = join(from, name);
      const dst = join(to, name);
      if (name === 'MEMORY.md') {
        const have = existsSync(dst) ? readFileSync(dst, 'utf8') : '';
        const known = new Set(have.split('\n'));
        const add = readFileSync(src, 'utf8').split('\n').filter((l) => l.trim() && !known.has(l));
        if (add.length) writeFileSync(dst, have + (have && !have.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
      } else if (statSync(src).mtimeMs > seeded && (!existsSync(dst) || statSync(src).mtimeMs > statSync(dst).mtimeMs)) {
        // ponytail: newer edit wins (timestamps kept); two parallel edits of one topic file keep only the later one
        cpSync(src, dst, { recursive: true, preserveTimestamps: true });
      }
    }
  } catch (e) {
    process.stderr.write(`sync-memory: ${e.message}\n`);
  }
});
