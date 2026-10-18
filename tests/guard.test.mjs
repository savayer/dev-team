// Tests for hooks/guard.mjs — run: node --test tests/guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeBranch } from '../hooks/merge-branch.mjs';

// GUARD_HOOK points the suite at a mutated copy (mutation checks)
const HOOK = process.env.GUARD_HOOK ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard.mjs');
const MERGE_BRANCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'merge-branch.mjs');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();

function writeFiles(dir, files) {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
}

// origin (bare, default develop; `base` files committed there) ← clone `work` on team/a:
// `mv` renames and `team` files written in one commit on top of develop, pushed.
// `slot`: team/a moves to <root>/.team-worktrees/agent-1 (`work`), a worktree of the clone (`main`), as in a multi-repo workspace
export function makeRepo({ base = {}, team = { 'a.txt': 'a\n' }, mv, slot = false } = {}) {
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
  const sha = git(work, 'rev-parse', 'HEAD');
  if (!slot) return { root, origin, work, sha };
  const wt = join(root, '.team-worktrees', 'agent-1');
  git(work, 'checkout', '-q', '--detach');
  git(work, 'worktree', 'add', '-q', wt, 'team/a');
  return { root, origin, main: work, work: wt, sha };
}

// fake gh first on PATH: answers `pr view` from env, fails on FAKE_GH_FAIL
export const BIN = mkdtempSync(join(tmpdir(), 'fakegh-'));
writeFileSync(join(BIN, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
if (process.env.FAKE_GH_FAIL) { process.stderr.write('boom'); process.exit(1); }
// FAKE_PR_SEQ: a JSON array of answers, one per call (counted in FAKE_PR_SEQ_FILE) — a PR changing between reads
if (a.startsWith('pr view') && process.env.FAKE_PR_SEQ) {
  const fs = require('node:fs');
  const f = process.env.FAKE_PR_SEQ_FILE;
  const i = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0;
  fs.writeFileSync(f, String(i + 1));
  const seq = JSON.parse(process.env.FAKE_PR_SEQ);
  process.stdout.write(JSON.stringify(seq[Math.min(i, seq.length - 1)]));
} else if (a.startsWith('pr view')) process.stdout.write(process.env.FAKE_PR_JSON ?? '{}');
else if (a.startsWith('repo view')) process.stdout.write(process.env.FAKE_REPO_JSON ?? '{"visibility":"PRIVATE"}');
else process.exit(1);
`);
chmodSync(join(BIN, 'gh'), 0o755);

export function runHook(command, agent_type, { cwd, env = {}, tool_name = 'Bash', tool_input = { command } } = {}) {
  const base = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  for (const k of ['TEAM_MERGE_BRANCH', 'GH_REPO', 'GH_HOST', 'CLAUDE_PROJECT_DIR']) delete base[k];
  const r = spawnSync('node', [HOOK], {
    cwd: cwd ?? process.cwd(),
    input: JSON.stringify({ tool_name, tool_input, agent_type, cwd: cwd ?? '' }),
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const repo = makeRepo();

test('existing forms keep their behaviour', () => {
  const cases = [
    ['git push -u origin team/a', 'dev-team-head-pm', 0],
    ['git push -u origin team/b', 'dev-team-head-pm', 2],
    ['git push -u origin team/a', 'dev-team-backend-lead', 2],
    ['gh pr create --base develop --title t --body-file .team/pr-body.md', 'dev-team-head-pm', 0],
    ['gh pr create --title t', 'dev-team-backend-lead', 2],
    ['gh pr view 1 --json state', 'claude', 0],
    ['gh repo view --json defaultBranchRef -q .defaultBranchRef.name', 'dev-team-head-pm', 0],
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
  for (const cmd of cases) assert.equal(runHook(cmd, 'dev-team-head-pm', { cwd: repo.work }).status, 2, cmd);
});

test('documented false positives: the word gh in text is blocked', () => {
  assert.equal(runHook("printf '%s' 'gh pr list'", 'dev-team-qa-lead', { cwd: repo.work }).status, 2);
  assert.equal(runHook('git commit -m "fix gh link"', 'dev-team-head-pm', { cwd: repo.work }).status, 2);
});

test('the main session and agents outside the team are not guarded', () => {
  const cmds = ['git push origin main', 'gh pr merge 7 --admin', 'kubectl apply -f k.yml', 'npm publish', 'git stash'];
  for (const agent of ['claude', 'Explore', 'general-purpose', 'head-pm']) {
    for (const cmd of cmds) assert.equal(runHook(cmd, agent, { cwd: repo.work }).status, 0, `${agent}: ${cmd}`);
    assert.equal(runHook('', agent, { tool_name: 'Read', tool_input: { file_path: '/p/.env' } }).status, 0, `${agent}: read .env`);
  }
});

test('team agents: publish, deploy and hook-bypass commands are denied', () => {
  const cases = [
    'npm publish', 'pnpm publish --access public', 'yarn publish', 'yarn npm publish', 'bun publish', 'cargo publish',
    'npm --registry https://r.example.com publish',
    'docker push img', 'docker image push img', 'docker compose push', 'docker buildx build --push .',
    'git commit --no-verify -m x', 'git commit -n -m x', 'git commit -nm x', 'git config core.hooksPath /dev/null',
    'HUSKY=0 git commit -m x', 'git stash', 'git stash pop', 'git -c core.hooksPath=x commit -m x',
    'kubectl apply -f k.yml', 'kubectl delete pod x', 'kubectl exec -it x -- sh', 'timeout 60 kubectl rollout restart deploy/x',
    'helm upgrade x ./chart', 'helm install x ./chart', 'terraform apply', 'cd infra && terraform plan', 'tofu apply', 'pulumi up',
  ];
  for (const cmd of cases) {
    const r = runHook(cmd, 'dev-team-senior-engineer', { cwd: repo.work });
    assert.equal(r.status, 2, cmd);
    assert.match(r.stderr, /dev-team guard/, cmd);
  }
});

test('no agent_type (a team agent run as the main session) is guarded like the team', () => {
  for (const agent of [undefined, '']) {
    assert.equal(runHook('npm publish', agent, { cwd: repo.work }).status, 2, `${agent}: publish`);
    assert.equal(runHook('git push -u origin team/a', agent, { cwd: repo.work }).status, 2, `${agent}: push`);
  }
});

test('team agents: ordinary commands pass', () => {
  const cases = [
    'npm ci', 'npm test', 'npm run publish-docs', 'git commit -m "fix: x"', 'git status', 'kubectl get pods -o yaml | grep create', 'docker build -t x .',
    'git add infra/terraform/main.tf', 'ls terraform', 'git add src/recipes/tofu.ts', 'git commit -m "handle -name flag"', 'git commit -m "docs: terraform notes"',
  ];
  for (const cmd of cases) assert.equal(runHook(cmd, 'dev-team-middle-engineer', { cwd: repo.work }).status, 0, cmd);
});

test('team agents: secrets are not read', () => {
  const read = (tool_name, tool_input) => runHook('', 'dev-team-backend-lead', { tool_name, tool_input }).status;
  for (const p of ['/p/.env', '/p/.env.local', '/p/apps/web/.env.production', '/p/key.pem', '/p/secrets/db.json', 'secrets/x']) {
    assert.equal(read('Read', { file_path: p }), 2, p);
  }
  assert.equal(read('Grep', { pattern: 'KEY', path: '/p/.env' }), 2, 'grep .env');
  assert.equal(read('Edit', { file_path: '/p/.env', old_string: 'a', new_string: 'b' }), 2, 'edit .env');
  assert.equal(read('Write', { file_path: '/p/secrets/x.json', content: '{}' }), 2, 'write secrets/');
  for (const p of ['/p/.env.example', '/p/src/env.ts', '/p/.envrc.md', '/p/secretsauce.md']) assert.equal(read('Read', { file_path: p }), 0, p);
  assert.equal(read('Grep', { pattern: 'x', path: '/p/src' }), 0, 'grep src');
});

test('head-pm push, PR and merge are approved, not just let through', () => {
  const allow = (r) => JSON.parse(r.stdout).hookSpecificOutput;
  for (const cmd of ['git push -u origin team/a', 'gh pr create --title t --body-file .team/pr-body.md']) {
    const r = runHook(cmd, 'dev-team-head-pm', { cwd: repo.work });
    assert.equal(r.status, 0, cmd);
    assert.deepEqual(allow(r), { hookEventName: 'PreToolUse', permissionDecision: 'allow' }, cmd);
  }
  const m = runHook(mergeCmd(repo), 'dev-team-head-pm', { cwd: repo.work, env: env(repo) });
  assert.equal(allow(m).permissionDecision, 'allow');
  assert.equal(runHook('git status', 'dev-team-head-pm', { cwd: repo.work }).stdout, '');
});

test('team agents: secrets stay out of shell commands too', () => {
  const run = (cmd) => runHook(cmd, 'dev-team-senior-engineer', { cwd: repo.work }).status;
  for (const cmd of ['cat .env', 'source .env', 'grep KEY apps/web/.env.local', "export $(cat '.env.production')", 'cat key.pem', 'cat secrets/db.json', 'node app.js --env-file=.env']) {
    assert.equal(run(cmd), 2, cmd);
  }
  for (const cmd of ['cat .env.example', 'node scripts/env.js', 'ls -la', 'grep -r dotenv src']) assert.equal(run(cmd), 0, cmd);
});

test('team agents: tokens and raw pushes are refused', () => {
  const run = (cmd) => runHook(cmd, 'dev-team-head-pm', { cwd: repo.work }).status;
  assert.equal(run('gh auth status'), 0);
  for (const cmd of ['gh auth status --show-token', 'gh auth status -t', 'gh auth token', 'git send-pack origin HEAD:refs/heads/main']) assert.equal(run(cmd), 2, cmd);
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
  const r = runHook(mergeCmd(repo), 'dev-team-head-pm', { cwd: repo.work, env: env(repo) });
  assert.equal(r.status, 0, r.stderr);
});

test('merge: switch, environment, agent, branch and commit checks', () => {
  const cases = [
    ['switch unset', mergeCmd(repo), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: undefined }, /merge mode is off/],
    ['switch empty', mergeCmd(repo), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: '' }, /merge mode is off/],
    ['switch starts with -', mergeCmd(repo), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: '-x' }, /must not start with -/],
    ['switch invalid ref', mergeCmd(repo), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: 'a..b' }, /not a valid branch name/],
    ['switch with spaces', mergeCmd(repo), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: ' develop' }, /not a valid branch name/],
    ['GH_REPO set', mergeCmd(repo), 'dev-team-head-pm', { GH_REPO: 'o/r' }, /GH_REPO is set/],
    ['GH_HOST set', mergeCmd(repo), 'dev-team-head-pm', { GH_HOST: 'example.com' }, /GH_HOST is set/],
    ['not dev-team-head-pm', mergeCmd(repo), 'dev-team-backend-lead', {}, /only dev-team-head-pm may merge/],
    ['other branch', mergeCmd(repo, 'team/b'), 'dev-team-head-pm', {}, /merge only your current branch/],
    ['sha is not HEAD', mergeCmd(repo, 'team/a', '0'.repeat(40)), 'dev-team-head-pm', {}, /must be your HEAD/],
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
  for (const [name, over, reason] of cases) denied(repo, mergeCmd(repo), 'dev-team-head-pm', { FAKE_PR_JSON: prJson(repo, over) }, reason, name);
  denied(repo, mergeCmd(repo), 'dev-team-head-pm', { FAKE_PR_JSON: 'not json' }, /merge check failed/, 'bad json');
  denied(repo, mergeCmd(repo), 'dev-team-head-pm', { FAKE_GH_FAIL: '1' }, /merge check failed/, 'gh fails');
});

test('merge: protected paths in the real diff are never auto-merged', () => {
  const many = Object.fromEntries(Array.from({ length: 149 }, (_, i) => [`src/f${i}.ts`, 'x\n']));
  for (const p of ['.claude/settings.json', '.github/workflows/ci.yml', '.husky/pre-commit', '.mcp.json', '.worktreeinclude', '.claude/ünï code.md']) {
    const r = makeRepo({ team: { ...many, [p]: 'x\n' } });
    denied(r, mergeCmd(r), 'dev-team-head-pm', {}, /touches/, p);
  }
  for (const [from, to] of [['.husky/pre-commit', 'scripts/pre-commit'], ['.claude/hooks/guard-push.mjs', 'src/guard-push.mjs']]) {
    const r = makeRepo({ base: { [from]: 'x\n' }, team: {}, mv: [from, to] });
    denied(r, mergeCmd(r), 'dev-team-head-pm', {}, /touches/, `moved out: ${from}`);
  }
  const ok = makeRepo({ team: { 'src/.claude-notes.md': 'x\n', 'docs/a.md': 'x\n' } });
  const res = runHook(mergeCmd(ok), 'dev-team-head-pm', { cwd: ok.work, env: env(ok) });
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
  for (const cmd of cases) denied(repo, cmd, 'dev-team-head-pm', {}, /allowed forms are/, cmd);
});

test('merge: dirty tree is denied', () => {
  const r = makeRepo();
  writeFileSync(join(r.work, 'a.txt'), 'changed\n');
  denied(r, mergeCmd(r), 'dev-team-head-pm', {}, /tracked changes/, 'dirty');
});

test('merge: base moved since the branch caught up → denied with "base moved"', () => {
  const r = makeRepo();
  const other = join(r.root, 'other');
  execFileSync('git', ['clone', '-q', '-b', 'develop', r.origin, other], { env: GIT_ENV, stdio: 'ignore' });
  git(other, 'commit', '-q', '--allow-empty', '-m', 'someone else merged');
  git(other, 'push', '-q', 'origin', 'develop');
  denied(r, mergeCmd(r), 'dev-team-head-pm', {}, /base moved/, 'base moved');
});

const settings = (dir, value) => writeFiles(dir, { '.claude/settings.local.json': JSON.stringify({ env: { TEAM_MERGE_BRANCH: value } }) });

test('merge branch: a single repo takes the session env, never the file', () => {
  const r = makeRepo();
  settings(r.work, 'main');
  assert.equal(mergeBranch({ cwd: r.work, env: { TEAM_MERGE_BRANCH: 'develop' } }), 'develop');
  assert.equal(mergeBranch({ cwd: r.work, env: {} }), '');
  assert.equal(mergeBranch({ cwd: '', env: { TEAM_MERGE_BRANCH: 'develop' } }), 'develop');
});

test('merge branch: in a multi-repo slot only the repo\'s settings.local.json counts', () => {
  const r = makeRepo({ slot: true });
  const on = { TEAM_MERGE_BRANCH: 'develop' };
  assert.equal(mergeBranch({ cwd: r.work, env: on }), '', 'no line: off, even with the env set');
  writeFiles(r.main, { '.claude/settings.local.json': '{ not json' });
  assert.equal(mergeBranch({ cwd: r.work, env: on }), '', 'bad json: off');
  settings(r.main, 7);
  assert.equal(mergeBranch({ cwd: r.work, env: on }), '', 'not a string: off');
  settings(r.main, 'develop');
  assert.equal(mergeBranch({ cwd: r.work, env: {} }), 'develop');
  mkdirSync(join(r.work, 'src'));
  assert.equal(mergeBranch({ cwd: join(r.work, 'src'), env: { TEAM_MERGE_BRANCH: 'main' } }), 'develop', 'from a subfolder');
  assert.equal(mergeBranch({ repo: r.main, env: { TEAM_MERGE_BRANCH: 'main' } }), 'develop', 'repo given');
});

test('merge-branch CLI: --repo names a repo of the workspace, otherwise the current folder', () => {
  const r = makeRepo({ slot: true });
  const plain = makeRepo();
  settings(r.main, 'develop');
  const link = join(r.root, 'dev-team');
  symlinkSync(join(dirname(MERGE_BRANCH), '..'), link); // installed as ~/.claude/dev-team → this repo
  const cli = (cwd, args, env = {}, script = MERGE_BRANCH) => {
    const e = { ...process.env, ...env };
    if (!('TEAM_MERGE_BRANCH' in env)) delete e.TEAM_MERGE_BRANCH;
    delete e.CLAUDE_PROJECT_DIR;
    const res = spawnSync('node', [script, ...args], { cwd, env: e, encoding: 'utf8' });
    assert.equal(res.stderr, '');
    return res.stdout;
  };
  assert.equal(cli(r.root, ['--repo', r.main], { TEAM_MERGE_BRANCH: 'main' }), 'develop\n');
  assert.equal(cli(r.root, ['--repo', plain.work], { TEAM_MERGE_BRANCH: 'develop' }), '', '--repo ignores the env');
  assert.equal(cli(r.work, []), 'develop\n', 'a slot');
  assert.equal(cli(r.work, [], {}, join(link, 'hooks', 'merge-branch.mjs')), 'develop\n', 'through the install symlink');
  assert.equal(cli(plain.work, [], { TEAM_MERGE_BRANCH: 'develop' }), 'develop\n', 'a single repo: the env');
  assert.equal(cli(plain.work, []), '');
});

test('merge in a multi-repo slot: the repo\'s settings.local.json decides, the session env is ignored', () => {
  const r = makeRepo({ slot: true });
  denied(r, mergeCmd(r), 'dev-team-head-pm', {}, /merge mode is off/, 'env set, no line in the repo');
  settings(r.main, 'develop');
  const res = runHook(mergeCmd(r), 'dev-team-head-pm', { cwd: r.work, env: { FAKE_PR_JSON: prJson(r) } });
  assert.equal(res.status, 0, res.stderr);
  settings(r.main, 'release');
  denied(r, mergeCmd(r), 'dev-team-head-pm', {}, /merge mode allows only release/, 'the repo\'s base, not the env\'s');
});

test('merge branch: CLAUDE_PROJECT_DIR of a non-git workspace means multi-repo outside a slot too', () => {
  const r = makeRepo();
  const on = { TEAM_MERGE_BRANCH: 'develop', CLAUDE_PROJECT_DIR: r.root };
  assert.equal(mergeBranch({ cwd: r.work, env: on }), '', 'a repo without the line');
  assert.equal(mergeBranch({ cwd: r.root, env: on }), '', 'cwd not in a repo');
  settings(r.work, 'main');
  assert.equal(mergeBranch({ cwd: r.work, env: on }), 'main');
  assert.equal(mergeBranch({ cwd: r.work, env: { ...on, CLAUDE_PROJECT_DIR: r.work } }), 'develop', 'a git repo: single repo');
  assert.equal(mergeBranch({ cwd: r.work, env: { ...on, CLAUDE_PROJECT_DIR: 'ws' } }), 'develop', 'not absolute: ignored');
});

test('merge in a multi-repo session from a main checkout: the workspace env is ignored', () => {
  const r = makeRepo();
  const ws = { CLAUDE_PROJECT_DIR: r.root }; // the non-git folder holding the repo
  denied(r, mergeCmd(r), 'dev-team-head-pm', ws, /merge mode is off/, 'workspace env, no line in the repo');
  settings(r.work, 'develop');
  const res = runHook(mergeCmd(r), 'dev-team-head-pm', { cwd: r.work, env: { ...ws, FAKE_PR_JSON: prJson(r) } });
  assert.equal(res.status, 0, res.stderr);
});

test('merge in a single-repo session: CLAUDE_PROJECT_DIR is the repo, the env decides as before', () => {
  const r = makeRepo();
  const res = runHook(mergeCmd(r), 'dev-team-head-pm', { cwd: r.work, env: env(r, { CLAUDE_PROJECT_DIR: r.work }) });
  assert.equal(res.status, 0, res.stderr);
});

// TEAM_MERGE_BRANCH=master over a develop base: origin also has master (at develop's base commit)
function promoteRepo(opts) {
  const r = makeRepo(opts);
  git(r.work, 'push', '-q', 'origin', 'origin/develop:refs/heads/master');
  git(r.work, 'fetch', '-q', 'origin');
  return r;
}
// the PR merged into develop on origin; team/a stays checked out
function mergeOnDevelop(r) {
  const other = join(r.root, `merger-${Math.random().toString(36).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-b', 'develop', r.origin, other], { env: GIT_ENV, stdio: 'ignore' });
  git(other, 'merge', '-q', '--no-ff', '-m', 'merge team/a', 'origin/team/a');
  git(other, 'push', '-q', 'origin', 'develop');
  return git(other, 'rev-parse', 'HEAD');
}
const toMaster = { TEAM_MERGE_BRANCH: 'master' };
const ffCmd = (sha, target) => `git push origin ${sha}:refs/heads/${target}`;

test('promote: master over a develop base merges the develop PR', () => {
  const r = promoteRepo();
  const res = runHook(mergeCmd(r), 'dev-team-head-pm', { cwd: r.work, env: env(r, toMaster) });
  assert.equal(res.status, 0, res.stderr);
});

test('promote: master that moved past the branch, or an unrelated switch, is denied', () => {
  const r = promoteRepo();
  const other = join(r.root, 'bot');
  execFileSync('git', ['clone', '-q', '-b', 'master', r.origin, other], { env: GIT_ENV, stdio: 'ignore' });
  git(other, 'commit', '-q', '--allow-empty', '-m', 'bot bump on master');
  git(other, 'push', '-q', 'origin', 'master');
  denied(r, mergeCmd(r), 'dev-team-head-pm', toMaster, /master moved: merge origin\/master/, 'master moved');
  const q = promoteRepo();
  denied(q, mergeCmd(q), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: 'release' }, /merge mode allows only release/, 'unrelated switch');
  denied(q, mergeCmd(q), 'dev-team-head-pm', { TEAM_MERGE_BRANCH: 'master', FAKE_PR_JSON: prJson(q, { baseRefName: 'staging' }) }, /allows only develop or master/, 'other base');
});

test('public repo: gh pr merge is denied, the fast-forward to the base passes', () => {
  const r = promoteRepo();
  const pub = { FAKE_REPO_JSON: '{"visibility":"PUBLIC"}' };
  denied(r, mergeCmd(r), 'dev-team-head-pm', pub, /repo is not private: fast-forward instead/, 'public merge');
  for (const sw of [{}, toMaster]) {
    const res = runHook(ffCmd(r.sha, 'develop'), 'dev-team-head-pm', { cwd: r.work, env: env(r, { ...pub, ...sw }) });
    assert.equal(res.status, 0, res.stderr);
  }
  denied(r, ffCmd('0'.repeat(40), 'develop'), 'dev-team-head-pm', pub, /must be your HEAD/, 'ff of another commit');
  denied(r, ffCmd(r.sha, 'develop'), 'dev-team-head-pm', { ...pub, FAKE_PR_JSON: prJson(r, { state: 'MERGED' }) }, /not OPEN/, 'ff of a merged PR');
  for (const visibility of ['PRIVATE', 'INTERNAL']) {
    denied(r, ffCmd(r.sha, 'develop'), 'dev-team-head-pm', { FAKE_REPO_JSON: JSON.stringify({ visibility }) }, /repo is private: merge with gh pr merge/, visibility);
  }
});

test('fast-forward: the PR is read once, so a retarget between reads does not hide protected files', () => {
  const r = makeRepo();
  git(r.work, 'push', '-q', 'origin', 'origin/develop:refs/heads/main');
  const other = join(r.root, 'on-main');
  execFileSync('git', ['clone', '-q', '-b', 'main', r.origin, other], { env: GIT_ENV, stdio: 'ignore' });
  writeFiles(other, { '.github/workflows/ci.yml': 'x\n' });
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'ci on main only');
  git(other, 'push', '-q', 'origin', 'main');
  git(r.work, 'fetch', '-q', 'origin');
  git(r.work, 'merge', '-q', '--no-edit', 'origin/main');
  git(r.work, 'push', '-q', 'origin', 'team/a');
  const sha = git(r.work, 'rev-parse', 'HEAD');
  const seq = JSON.stringify([JSON.parse(prJson(r, { headRefOid: sha })), JSON.parse(prJson(r, { headRefOid: sha, baseRefName: 'main' }))]);
  const over = { TEAM_MERGE_BRANCH: 'main', FAKE_REPO_JSON: '{"visibility":"PUBLIC"}', FAKE_PR_SEQ: seq, FAKE_PR_SEQ_FILE: join(r.root, 'seq') };
  denied(r, ffCmd(sha, 'develop'), 'dev-team-head-pm', over, /PR touches \.github/, 'retargeted between reads');
});

test('promote: the PR\'s merge commit on develop fast-forwards master', () => {
  const r = promoteRepo();
  const m = mergeOnDevelop(r);
  const merged = { ...toMaster, FAKE_PR_JSON: prJson(r, { state: 'MERGED', mergeCommit: { oid: m } }) };
  const res = runHook(ffCmd(m, 'master'), 'dev-team-head-pm', { cwd: r.work, env: env(r, merged) });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'allow');
  const cases = [
    ['not head-pm', ffCmd(m, 'master'), 'dev-team-backend-lead', merged, /only dev-team-head-pm may merge/],
    ['switch off', ffCmd(m, 'master'), 'dev-team-head-pm', { ...merged, TEAM_MERGE_BRANCH: undefined }, /merge mode is off/],
    ['no promotion with develop', ffCmd(m, 'master'), 'dev-team-head-pm', { ...merged, TEAM_MERGE_BRANCH: 'develop' }, /push target must be develop, not master/],
    ['other target', ffCmd(m, 'release'), 'dev-team-head-pm', merged, /push target must be develop or master/],
    ['PR still open', ffCmd(m, 'master'), 'dev-team-head-pm', { ...toMaster, FAKE_PR_JSON: prJson(r) }, /promote only after/],
    ['not the merge commit', ffCmd(r.sha, 'master'), 'dev-team-head-pm', merged, /not the PR's merge commit/],
  ];
  for (const [name, cmd, agent, over, reason] of cases) denied(r, cmd, agent, over, reason, name);
});

test('promote: a commit not on develop, or master moved, is denied', () => {
  const r = promoteRepo();
  const offDevelop = { ...toMaster, FAKE_PR_JSON: prJson(r, { state: 'MERGED', mergeCommit: { oid: r.sha } }) };
  denied(r, ffCmd(r.sha, 'master'), 'dev-team-head-pm', offDevelop, /is not on origin\/develop/, 'not on develop');
  const m = mergeOnDevelop(r);
  const bot = join(r.root, 'bot');
  execFileSync('git', ['clone', '-q', '-b', 'master', r.origin, bot], { env: GIT_ENV, stdio: 'ignore' });
  git(bot, 'commit', '-q', '--allow-empty', '-m', 'bot bump on master');
  git(bot, 'push', '-q', 'origin', 'master');
  const merged = { ...toMaster, FAKE_PR_JSON: prJson(r, { state: 'MERGED', mergeCommit: { oid: m } }) };
  denied(r, ffCmd(m, 'master'), 'dev-team-head-pm', merged, /master moved: not a fast-forward/, 'master moved');
});

test('promote: protected paths that develop would bring to master are left to the Owner', () => {
  const r = promoteRepo();
  const other = join(r.root, 'human');
  execFileSync('git', ['clone', '-q', '-b', 'develop', r.origin, other], { env: GIT_ENV, stdio: 'ignore' });
  writeFiles(other, { '.github/workflows/ci.yml': 'x\n' });
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'ci on develop');
  git(other, 'push', '-q', 'origin', 'develop');
  git(r.work, 'fetch', '-q', 'origin');
  git(r.work, 'merge', '-q', '--no-edit', 'origin/develop');
  git(r.work, 'push', '-q', 'origin', 'team/a');
  const m = mergeOnDevelop(r);
  const merged = { ...toMaster, FAKE_PR_JSON: prJson(r, { state: 'MERGED', mergeCommit: { oid: m } }) };
  denied(r, ffCmd(m, 'master'), 'dev-team-head-pm', merged, /promotion touches \.github/, 'protected on develop');
});

test('fast-forward: other push forms stay denied', () => {
  const s = repo.sha;
  const cases = [
    `git push origin +${s}:refs/heads/master`,
    `git push -f origin ${s}:refs/heads/master`,
    `git push --force-with-lease origin ${s}:refs/heads/master`,
    `git push origin HEAD:refs/heads/master`,
    `git push origin ${s}:master`,
    `git push origin ${s}:refs/heads/master; true`,
    `git push origin ${s}:refs/tags/prod-1`,
  ];
  for (const cmd of cases) denied(repo, cmd, 'dev-team-head-pm', toMaster, /allowed forms are/, cmd);
});

test('fast-forward: origin with its own push URL or refspec is denied', () => {
  for (const [key, val] of [['remote.origin.pushurl', '/elsewhere.git'], ['remote.origin.push', 'refs/heads/*:refs/heads/x/*']]) {
    const r = promoteRepo();
    git(r.work, 'config', key, val);
    denied(r, ffCmd(r.sha, 'develop'), 'dev-team-head-pm', { FAKE_REPO_JSON: '{"visibility":"PUBLIC"}' }, new RegExp(`${key.replace(/\./g, '\\.')} is set`), key);
  }
});
