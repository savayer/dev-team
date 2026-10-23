#!/usr/bin/env node
// PreToolUse guard of the dev team, wired into every dev-team-* agent's frontmatter (Bash, Read, Grep, Edit, Write).
// Anyone else — the main session, other agents — passes untouched.
//
// Bans: publishing, image pushes, cluster and infrastructure changes, hook bypass, git stash, deleting files,
// reading secrets (.env*, *.pem, secrets/). Any git push or gh call must match the allowlist exactly.
// Push and PR creation: dev-team-head-pm only; push only the current team/* branch. Merge: dev-team-head-pm only, in
// merge mode (TEAM_MERGE_BRANCH), its own team/* PR at the tested commit (see MERGE; a fast-forward in public repos)
// and, with master|main over a develop base, a fast-forward of that merge to master|main (see FF_PUSH). Other merges,
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
// fast-forward of an exact commit: the PR head to its base (public repos), or the merge on develop to master/main
const FF_PUSH = full(String.raw`git push origin ([0-9a-f]{40}):refs/heads/([A-Za-z0-9._/-]+)`);
// TEAM_MERGE_BRANCH=master|main over a develop base: merge into develop, then fast-forward the branch to that merge
const PROMOTE_TO = new Set(['master', 'main']);
// never auto-merged: they change the Owner's environment on the next pull
const PROTECTED = /^(\.claude\/|\.github\/|\.husky\/|\.mcp\.json$|\.worktreeinclude$)/;
const SUB = { encoding: 'utf8', timeout: 20_000 };
const ANYONE = [
  full(`gh pr (view|list|diff|checks|status)${ARGS}`),
  full('gh auth status'), // no flags: --show-token would print the token
  full(`gh repo view${ARGS}`),
];
// deleting files, even in temp folders: the Owner gets a permission prompt for it and the whole team waits
const RM = String.raw`(?:/(?:usr/)?bin/)?(?:rm|rmdir|unlink)(?=$|[\s;&|<>()])`;
const DELETES = [
  // in command position: after a separator, a shell keyword, a wrapper with its options or VAR= prefixes
  String.raw`(?:^|[;&|({\n]|\b(?:then|do|else|if|elif|while|until|command)\b|\b(?:sudo|nohup|env|xargs|timeout)(?:\s+-\S+(?:\s+[^-\s]\S*)?)*(?:\s+\d\S*)?)(?:\s*\w+=\S*)*\s*${RM}`,
  String.raw`\bfind\b[^;&|\n]*\s(?:-delete(?=$|[\s;&|<>()])|-exec(?:dir)?\s+${RM})`,
  String.raw`\bgit(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+clean\b(?![^;&|\n]*\s(?:-[A-Za-z]*n[A-Za-z]*|--dry-run)(?=\s|$))`,
];
const KEEP_FILES =
  'is not needed — write scratch output to a new folder or over files with the same name, leftovers are fine; ' +
  'a tracked file the task removes: git rm <file>';
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
  [new RegExp(DELETES.join('|')), 'deleting files', KEEP_FILES],
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

// merge mode: dev-team-head-pm merges its own open PR, at the commit it tested, into its base when TEAM_MERGE_BRANCH
// is that base; TEAM_MERGE_BRANCH=master|main over a develop base also lets it fast-forward master|main to that merge
// (merge-branch.mjs: the session env, or the repo's own settings in a multi-repo workspace)
function mergeSwitch(cwd) {
  const value = mergeBranch({ cwd });
  if (!value) {
    deny(
      'merge mode is off (TEAM_MERGE_BRANCH is not set: in .claude/settings.local.json of the project for a ' +
        "single repo, of the task's repo in a multi-repo workspace)",
    );
  }
  if (value.startsWith('-')) deny('TEAM_MERGE_BRANCH must not start with -');
  try {
    execFileSync('git', ['check-ref-format', '--branch', value], SUB);
  } catch {
    deny(`TEAM_MERGE_BRANCH is not a valid branch name: "${value}"`);
  }
  // the merge command runs with the same environment: it would target another repository
  for (const v of ['GH_REPO', 'GH_HOST']) if (process.env[v]) deny(`${v} is set: the merge would not target this checkout`);
  if (!cwd) deny('no cwd in hook input');
  return value;
}

// the PR's base when merge mode covers it; the branch to promote to afterwards, or '' when there is none
function mergeTargets(value, prBase) {
  if (prBase === value) return { base: prBase, promote: '' };
  if (PROMOTE_TO.has(value) && prBase === 'develop') return { base: prBase, promote: value };
  deny(`PR base is ${prBase}, merge mode allows only ${PROMOTE_TO.has(value) ? `develop or ${value}` : value}`);
}

const isAncestor = (cwd, a, b) => {
  try {
    git(cwd, 'merge-base', '--is-ancestor', a, b);
    return true;
  } catch {
    return false;
  }
};

// the PR's diff, from git: both sides of a rename, unquoted names
function protectedIn(cwd, range) {
  return git(cwd, 'diff', '--name-only', '--no-renames', '-z', range).split('\0').filter(Boolean).filter((f) => PROTECTED.test(f));
}

// one snapshot of the PR per check: a second read could see it retargeted
const prView = (cwd, branch) =>
  JSON.parse(gh(cwd, 'pr', 'view', branch, '--json', 'state,baseRefName,headRefName,headRefOid,isCrossRepository,mergeCommit'));

// a GitHub merge commit carries the account's name and email: public history gets a fast-forward instead
function isPrivate(cwd) {
  const { visibility } = JSON.parse(gh(cwd, 'repo', 'view', '--json', 'visibility'));
  return visibility === 'PRIVATE' || visibility === 'INTERNAL';
}

// own open PR at sha = HEAD, caught up with its base (and with the branch it will be promoted to); checks use the
// sha itself, so a HEAD moved meanwhile changes nothing
function checkOpenPr(cwd, branch, sha, value, pr) {
  if (git(cwd, 'branch', '--show-current') !== branch) deny(`merge only your current branch, not ${branch}`);
  if (git(cwd, 'rev-parse', 'HEAD') !== sha) deny(`${sha} must be your HEAD`);
  try {
    git(cwd, 'diff', '--quiet', 'HEAD');
  } catch {
    deny('commit or discard tracked changes first');
  }
  if (pr.state !== 'OPEN') deny(`PR is ${pr.state}, not OPEN`);
  if (pr.headRefName !== branch || pr.headRefOid !== sha) deny('PR head is not your branch at your HEAD — push first');
  if (pr.isCrossRepository) deny('PR comes from a fork');
  const { base, promote } = mergeTargets(value, pr.baseRefName);
  for (const b of [base, promote].filter(Boolean)) {
    git(cwd, 'fetch', '-q', 'origin', b);
    if (!isAncestor(cwd, `origin/${b}`, sha)) {
      deny(`${b === base ? 'base' : b} moved: merge origin/${b} into ${branch}, re-run the checks, push, then merge again`);
    }
  }
  const touched = protectedIn(cwd, `origin/${base}...${sha}`);
  if (touched.length) deny(`PR touches ${touched.join(', ')} — the Owner merges such PRs by hand`);
  return base;
}

function checkMerge(cwd, branch, sha) {
  const value = mergeSwitch(cwd);
  try {
    checkOpenPr(cwd, branch, sha, value, prView(cwd, branch));
    if (!isPrivate(cwd)) deny(`the repo is not private: fast-forward instead — git push origin ${sha}:refs/heads/<base>`);
  } catch (e) {
    deny(`merge check failed (${e.message.split('\n')[0]})`);
  }
}

// `git push origin <sha>:refs/heads/<target>`, never forced: the open PR's head to its base, or the PR's merge
// commit on develop to master|main (promotion)
function checkFastForward(cwd, sha, target) {
  const value = mergeSwitch(cwd);
  try {
    // the PR and visibility come from the repo gh sees; the push must land in that same origin
    for (const key of ['remote.origin.pushurl', 'remote.origin.push']) {
      let set = '';
      try {
        set = git(cwd, 'config', '--get-all', key);
      } catch {}
      if (set) deny(`${key} is set: the push would not go where the checks looked`);
    }
    const branch = git(cwd, 'branch', '--show-current');
    if (!branch.startsWith('team/')) deny(`push from your team/* branch, not ${branch || 'a detached HEAD'}`);
    const pr = prView(cwd, branch);
    if (pr.headRefName !== branch) deny(`PR head is ${pr.headRefName}, not your branch`);
    if (pr.isCrossRepository) deny('PR comes from a fork');
    const { base, promote } = mergeTargets(value, pr.baseRefName);
    if (target === base) {
      if (isPrivate(cwd)) deny(`the repo is private: merge with gh pr merge ${branch} --merge --match-head-commit ${sha}`);
      checkOpenPr(cwd, branch, sha, value, pr);
      return;
    }
    if (!promote || target !== promote) deny(`push target must be ${promote ? `${base} or ${promote}` : base}, not ${target}`);
    if (pr.state !== 'MERGED') deny(`PR is ${pr.state}: promote only after it is merged into ${base}`);
    if (pr.mergeCommit?.oid !== sha) deny(`${sha} is not the PR's merge commit`);
    for (const b of [base, promote]) git(cwd, 'fetch', '-q', 'origin', b);
    if (!isAncestor(cwd, sha, `origin/${base}`)) deny(`${sha} is not on origin/${base}`);
    if (!isAncestor(cwd, `origin/${promote}`, sha)) deny(`${promote} moved: not a fast-forward — the Owner promotes by hand`);
    const touched = protectedIn(cwd, `origin/${promote}...${sha}`);
    if (touched.length) deny(`the promotion touches ${touched.join(', ')} — the Owner promotes such changes by hand`);
  } catch (e) {
    deny(`fast-forward check failed (${e.message.split('\n')[0]})`);
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
  for (const [re, what, why = 'is not for the team — leave it to the Owner'] of BANS) if (re.test(bare)) deny(`${what} ${why}`);
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
  const ff = cmd.match(FF_PUSH);
  if (ff) {
    if (agent !== 'dev-team-head-pm') deny('only dev-team-head-pm may merge, and only in merge mode');
    checkFastForward(cwd, ff[1], ff[2]);
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
      '`gh pr merge team/<name> --merge --match-head-commit <sha>` and `git push origin <sha>:refs/heads/<branch>` ' +
      '(dev-team-head-pm only, each as a standalone command), plus read-only `gh pr view|list|diff|checks|status`. ' +
      'Text that mentions gh goes in a file.',
  );
});
