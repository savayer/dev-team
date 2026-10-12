#!/usr/bin/env node
// Stop hook in the leads' frontmatter (runs as SubagentStop): copy the lead's local memory from its
// task worktree back to the main checkout, where dev-team-head-pm seeds the next worktree from.
// Never blocks: always exits 0, problems go to stderr.

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const { agent_type: agent, cwd } = JSON.parse(input);
    if (!agent || !cwd) return;
    const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
    const root = git('rev-parse', '--show-toplevel');
    const main = dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir')); // <main>/.git
    if (resolve(root) === resolve(main)) return;
    const from = join(root, '.claude/agent-memory-local', agent);
    if (!existsSync(from)) return;
    // head-pm seeds memory right after the worktree is created, keeping mtimes (cp -Rp):
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
        // append, not rewrite: two leads finishing at once must not drop each other's lines
        if (add.length) appendFileSync(dst, (have && !have.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
      } else if (statSync(src).mtimeMs > seeded && (!existsSync(dst) || statSync(src).mtimeMs > statSync(dst).mtimeMs)) {
        // ponytail: newer edit wins (timestamps kept); two parallel edits of one topic file keep only the later one
        cpSync(src, dst, { recursive: true, preserveTimestamps: true });
      }
    }
  } catch (e) {
    process.stderr.write(`sync-memory: ${e.message}\n`);
  }
});
