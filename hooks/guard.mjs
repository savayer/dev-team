#!/usr/bin/env node
// PreToolUse guard of the dev team, wired into every dev-team-* agent's frontmatter (Bash, Read, Grep, Edit, Write).
// Anyone else — the main session, other agents — passes untouched.
//
// Bans: publishing, image pushes, cluster and infrastructure changes, hook bypass, git stash, reading
// secrets (.env*, *.pem, secrets/). Any git push or gh call must match the allowlist exactly.
// Push and PR creation: dev-team-head-pm only; push only the current team/* branch. Merge: dev-team-head-pm only, in
// merge mode (TEAM_MERGE_BRANCH), its own team/* PR at the tested commit (see MERGE). Other merges,
// force pushes, pushes to other branches, releases, workflows, gh api — blocked.
// Guards against mistakes of cooperative agents, not a hostile one: it sees only the command text.
// Exit 2 blocks the call; the hook entry turns any crash into exit 2 too. An allowed head-pm push, PR or
// merge is approved explicitly, so auto mode doesn't stop it.

import { execFileSync } from 'node:child_process';
import { mergeBranch } from './merge-branch.mjs';

const ARGS = String.raw`( [^;&|\x60$<>\\\n]*)?`; // plain arguments, no chaining or substitution
const full = (src) => new RegExp(`^(?:${src})$`);

const PUSH = full(String.raw`git push (?:-u |--set-upstream )?origin (team/[A-Za-z0-9._/-]+)`);
const PR_CREATE = full(`gh pr create${ARGS}`);
const MERGE = full(String.raw`gh pr merge (team/[A-Za-z0-9._/-]+) --merge --match-head-commit ([0-9a-f]{40})`);
// never auto-merged: they change the Owner's environment on the next pull
const PROTECTED = /^(\.claude\/|\.github\/|\.husky\/|\.mcp\.json$|\.worktreeinclude$)/;
const SUB = { encoding: 'utf8', timeout: 20_000 };
const ANYONE = [
  full(`gh pr (view|list|diff|checks|status)${ARGS}`),
  full('gh auth status'), // no flags: --show-token would print the token
  full(`gh repo view${ARGS}`),
];
// anywhere in the command outside quotes, so wrappers and chains don't hide them and a commit message doesn't trip them
const BANS = [
  [/\b(npm|pnpm|yarn|bun|cargo)\b[^;&|\n]*\spublish(?=\s|$)/, 'publishing packages'],
  [/\bdocker\b[^;&|\n]*\s(--)?push(?=[\s=]|$)/, 'pushing images'],
  [/--no-verify|\bgit\s+commit\b[^;&|\n]*\s-[A-Za-z]*n|core\.hooksPath|\bHUSKY=0/, 'bypassing git hooks'],
  [/\bgit\s+stash\b/, 'git stash (it hides changes from other agents)'],
  [/\bgit\s+-c\s/, 'git -c (it can switch hooks off)'],
  [/\bsend-pack\b/, 'git send-pack (pushes go through `git push`)'],
  [/\bkubectl\b[^;&|\n]*\s(apply|delete|create|patch|edit|scale|rollout|exec)\b/, 'changing a cluster'],
  [/\bhelm\b[^;&|\n]*\s(install|upgrade|uninstall|rollback|push)\b/, 'changing a cluster'],
  [/\b(terraform|tofu|pulumi)\s+-*[a-z]/, 'changing infrastructure'],
];
const SECRET = /(^|\/)\.env(\.(?!example$)[^/]*)?$|\.pem$|(^|\/)secrets(\/|$)/;
// git (with any options) push, or the word gh anywhere: wrappers (command, timeout, env, nohup),
// VAR= prefixes, $(which gh), blocks and new lines all reach the exact allowlist below.
// Text that merely mentions gh (a commit message, a prompt) is blocked too — put it in a file.
const TOUCHES = /\bgit(\s+-\S+(\s+[^-\s]\S*)?)*\s+push\b|\bgh\b/;

function deny(reason) {
  process.stderr.write(`Blocked by the dev-team guard: ${reason}\n`);
  process.exit(2);
}

function allow() {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  process.exit(0);
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], SUB).trim();
const gh = (cwd, ...args) => execFileSync('gh', args, { ...SUB, cwd });

// merge mode: dev-team-head-pm merges its own open PR, at the commit it tested, into TEAM_MERGE_BRANCH
// (merge-branch.mjs: the session env, or the repo's own settings in a multi-repo workspace)
function checkMerge(cwd, branch, sha) {
  const base = mergeBranch({ cwd });
  if (!base) {
    deny(
      'merge mode is off (TEAM_MERGE_BRANCH is not set: in .claude/settings.local.json of the project for a ' +
        "single repo, of the task's repo in a multi-repo workspace)",
    );
  }
  if (base.startsWith('-')) deny('TEAM_MERGE_BRANCH must not start with -');
  try {
    execFileSync('git', ['check-ref-format', '--branch', base], SUB);
  } catch {
    deny(`TEAM_MERGE_BRANCH is not a valid branch name: "${base}"`);
  }
  // the merge command runs with the same environment: it would target another repository
  for (const v of ['GH_REPO', 'GH_HOST']) if (process.env[v]) deny(`${v} is set: the merge would not target this checkout`);
  if (!cwd) deny('no cwd in hook input');
  try {
    if (git(cwd, 'branch', '--show-current') !== branch) deny(`merge only your current branch, not ${branch}`);
    if (git(cwd, 'rev-parse', 'HEAD') !== sha) deny('--match-head-commit must be your HEAD');
    try {
      git(cwd, 'diff', '--quiet', 'HEAD');
    } catch {
      deny('commit or discard tracked changes first');
    }
    const pr = JSON.parse(gh(cwd, 'pr', 'view', branch, '--json', 'state,baseRefName,headRefName,headRefOid,isCrossRepository'));
    if (pr.state !== 'OPEN') deny(`PR is ${pr.state}, not OPEN`);
    if (pr.headRefName !== branch || pr.headRefOid !== sha) deny('PR head is not your branch at your HEAD — push first');
    if (pr.isCrossRepository) deny('PR comes from a fork');
    if (pr.baseRefName !== base) deny(`PR base is ${pr.baseRefName}, merge mode allows only ${base}`);
    git(cwd, 'fetch', '-q', 'origin', base);
    try {
      git(cwd, 'merge-base', '--is-ancestor', `origin/${base}`, 'HEAD');
    } catch {
      deny(`base moved: merge origin/${base} into ${branch}, re-run the checks, push, then merge again`);
    }
    // the PR's diff, from git: both sides of a rename, unquoted names
    const files = git(cwd, 'diff', '--name-only', '--no-renames', '-z', `origin/${base}...HEAD`).split('\0').filter(Boolean);
    const touched = files.filter((f) => PROTECTED.test(f));
    if (touched.length) deny(`PR touches ${touched.join(', ')} — the Owner merges such PRs by hand`);
  } catch (e) {
    deny(`merge check failed (${e.message.split('\n')[0]})`);
  }
}

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let cmd, agent, cwd, tool, path;
  try {
    const data = JSON.parse(input);
    cmd = (data.tool_input?.command ?? '').trim();
    path = data.tool_input?.file_path ?? data.tool_input?.path ?? '';
    tool = data.tool_name ?? 'Bash';
    agent = data.agent_type ?? '';
    cwd = data.cwd ?? '';
  } catch (e) {
    deny(`cannot parse hook input (${e.message})`);
  }

  // no agent_type: a team agent running as the main session (claude --agent) — the hook is only wired into team agents
  if (agent && !agent.startsWith('dev-team-')) process.exit(0);
  if (tool !== 'Bash') {
    if (SECRET.test(path)) deny(`${path} may hold secrets — ask the Owner for what you need`);
    process.exit(0);
  }
  const bare = cmd.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
  for (const [re, what] of BANS) if (re.test(bare)) deny(`${what} is not for the team — leave it to the Owner`);
  const secret = cmd.split(/[\s'"`;&|<>()=$]+/).find((t) => SECRET.test(t));
  if (secret) deny(`${secret} may hold secrets — commands that touch it are the Owner's`);
  if (!TOUCHES.test(cmd)) process.exit(0);
  if (ANYONE.some((p) => p.test(cmd))) process.exit(0);
  const merge = cmd.match(MERGE);
  if (merge) {
    if (agent !== 'dev-team-head-pm') deny('only dev-team-head-pm may merge, and only in merge mode');
    checkMerge(cwd, merge[1], merge[2]);
    allow();
  }
  const push = cmd.match(PUSH);
  if (push || PR_CREATE.test(cmd)) {
    if (agent !== 'dev-team-head-pm') deny('only dev-team-head-pm may push or open PRs');
    if (push) {
      if (!cwd) deny('no cwd in hook input');
      let current = '';
      try {
        current = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
      } catch {}
      if (push[1] !== current) deny(`push only your current branch: pushing ${push[1]}, current is ${current || 'unknown'}`);
    }
    allow();
  }
  deny(
    'allowed forms are `git push -u origin team/<name>`, `gh pr create ...` and, in merge mode, ' +
      '`gh pr merge team/<name> --merge --match-head-commit <sha>` (dev-team-head-pm only, each as a standalone ' +
      'command), plus read-only `gh pr view|list|diff|checks|status`. Text that mentions gh goes in a file.',
  );
});
