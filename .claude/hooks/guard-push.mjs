#!/usr/bin/env node
// PreToolUse guard for Bash. Any git push or gh call must match the allowlist exactly.
//
// Push and PR creation: head-pm only; push only the current team/* branch. Merges, force pushes,
// pushes to other branches, releases, workflows, gh api — blocked.
// Exit 2 blocks the call; the settings entry turns any crash into exit 2 too.

import { execFileSync } from 'node:child_process';

const ARGS = String.raw`( [^;&|\x60$<>\\\n]*)?`; // plain arguments, no chaining or substitution
const full = (src) => new RegExp(`^(?:${src})$`);

const PUSH = full(String.raw`git push (?:-u |--set-upstream )?origin (team/[A-Za-z0-9._/-]+)`);
const PR_CREATE = full(`gh pr create${ARGS}`);
const ANYONE = [
  full(`gh pr (view|list|diff|checks|status)${ARGS}`),
  full(`gh (auth status|repo view)${ARGS}`),
];
// git (with any options) push, or gh, in command position — not inside commit messages
const TOUCHES = /\bgit(\s+-\S+(\s+[^-\s]\S*)?)*\s+push\b|(^|[;&|(`'"/]\s*)gh\s/;

function deny(reason) {
  process.stderr.write(`Blocked by .claude/hooks/guard-push.mjs: ${reason}\n`);
  process.exit(2);
}

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let cmd, agent, cwd;
  try {
    const data = JSON.parse(input);
    cmd = (data.tool_input?.command ?? '').trim();
    agent = data.agent_type ?? '';
    cwd = data.cwd ?? '';
  } catch (e) {
    deny(`cannot parse hook input (${e.message})`);
  }

  if (!TOUCHES.test(cmd)) process.exit(0);
  if (ANYONE.some((p) => p.test(cmd))) process.exit(0);
  const push = cmd.match(PUSH);
  if (push || PR_CREATE.test(cmd)) {
    if (agent !== 'head-pm') deny('only head-pm may push or open PRs');
    if (push) {
      if (!cwd) deny('no cwd in hook input');
      let current = '';
      try {
        current = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
      } catch {}
      if (push[1] !== current) deny(`push only your current branch: pushing ${push[1]}, current is ${current || 'unknown'}`);
    }
    process.exit(0);
  }
  deny(
    'allowed forms are `git push -u origin team/<name>` and `gh pr create ...` ' +
      '(head-pm only, run as a standalone command), plus read-only `gh pr view|list|diff|checks|status`',
  );
});
