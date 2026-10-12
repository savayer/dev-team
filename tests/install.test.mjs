// Tests for install.mjs — run: node --test tests/install.test.mjs
// Every test gets its own HOME, so the real ~/.claude and git config are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = join(ROOT, 'install.mjs');
const AGENTS = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md'));
const SKILLS = readdirSync(join(ROOT, 'skills'));

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };

function home(files = {}) {
  const h = mkdtempSync(join(tmpdir(), 'home-'));
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(h, p)), { recursive: true });
    writeFileSync(join(h, p), content);
  }
  return h;
}

function run(h, ...args) {
  const env = { ...process.env, HOME: h, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL']) delete env[k];
  return spawnSync('node', [INSTALL, ...args], { cwd: h, env, encoding: 'utf8' });
}

// every entry under dir: files by content, links by target
function tree(dir) {
  const out = {};
  for (const p of readdirSync(dir, { recursive: true })) {
    if (p.split(sep).includes('.git')) continue;
    const st = lstatSync(join(dir, p));
    if (st.isSymbolicLink()) out[p] = `-> ${readlinkSync(join(dir, p))}`;
    else if (st.isFile()) out[p] = read(join(dir, p));
  }
  return out;
}

test('fresh install links the team into ~/.claude', () => {
  const h = home();
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  for (const f of AGENTS) assert.equal(readlinkSync(join(h, '.claude/agents', f)), join(ROOT, 'agents', f), f);
  for (const s of SKILLS) assert.equal(readlinkSync(join(h, '.claude/skills', s)), join(ROOT, 'skills', s), s);
  assert.equal(readlinkSync(join(h, '.claude/rules/dev-team.md')), join(ROOT, 'rules/dev-team.md'));
  assert.equal(readlinkSync(join(h, '.claude/dev-team')), ROOT);
  assert.ok(existsSync(join(h, '.claude/dev-team/hooks/guard.mjs')));
  assert.deepEqual(json(join(h, '.claude/settings.json')), { env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3' } });
  assert.equal(read(join(h, '.config/git/ignore')), '.claude/worktrees/\n.claude/agent-memory-local/\n.team/\n');
  assert.match(r.stdout, /\/agents/);
});

test('second run changes nothing', () => {
  const h = home({ '.claude/settings.json': '{"model":"opus"}', '.config/git/ignore': '.DS_Store' });
  assert.equal(run(h).status, 0);
  const first = tree(h);
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(h), first);
  assert.equal(first[join('.config', 'git', 'ignore')], '.DS_Store\n.claude/worktrees/\n.claude/agent-memory-local/\n.team/\n');
});

test('settings: only the nesting depth changes, with a warning', () => {
  const before = { model: 'opus', env: { FOO: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' }, hooks: { Stop: [{ type: 'prompt', prompt: 'x' }] } };
  const h = home({ '.claude/settings.json': JSON.stringify(before) });
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(join(h, '.claude/settings.json')), { ...before, env: { FOO: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3' } });
  assert.match(r.stdout, /CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH/);
});

test('invalid settings: refuses and writes nothing', () => {
  for (const bad of ['{ "env": {}, // c\n}', 'null', '[]', '{"env": []}']) {
    const h = home({ '.claude/settings.json': bad });
    const before = tree(h);
    const r = run(h);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /settings\.json/, bad);
    assert.deepEqual(tree(h), before, bad);
  }
});

test('something else at a link path: refuses and writes nothing', () => {
  const file = home({ '.claude/agents/dev-team-reviewer.md': 'mine\n' });
  const dir = home();
  mkdirSync(join(dir, '.claude/skills'), { recursive: true });
  symlinkSync('/somewhere/else', join(dir, '.claude/skills/team'));
  for (const [h, name] of [[file, 'agents/dev-team-reviewer.md'], [dir, 'skills/team']]) {
    const before = tree(h);
    const r = run(h);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stderr, new RegExp(name), name);
    assert.deepEqual(tree(h), before, name);
  }
});

test('update: relinks and removes only its own links', () => {
  const h = home({
    '.claude/agents/notes.md': 'mine\n',
    '.claude/dev-team.json': JSON.stringify({ links: ['agents/dev-team-old.md', 'agents/notes.md', 'skills/team', '../outside'] }),
  });
  writeFileSync(join(h, 'outside'), 'keep');
  symlinkSync(join(ROOT, 'agents/dev-team-old.md'), join(h, '.claude/agents/dev-team-old.md')); // dropped by the team
  mkdirSync(join(h, '.claude/skills'));
  symlinkSync('/old/clone/skills/team', join(h, '.claude/skills/team')); // ours, from a clone that moved
  symlinkSync('/somewhere/else', join(h, '.claude/skills/foreign'));
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(h, '.claude/agents/dev-team-old.md')) && !lstatExists(join(h, '.claude/agents/dev-team-old.md')));
  assert.equal(readlinkSync(join(h, '.claude/skills/team')), join(ROOT, 'skills/team'));
  assert.equal(read(join(h, '.claude/agents/notes.md')), 'mine\n');
  assert.equal(readlinkSync(join(h, '.claude/skills/foreign')), '/somewhere/else');
  assert.equal(read(join(h, 'outside')), 'keep');
});

function lstatExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

test('links that land inside a git repo are hidden from it', () => {
  const h = home();
  const dot = join(h, 'dotfiles');
  mkdirSync(join(dot, '.claude/agents'), { recursive: true });
  writeFileSync(join(dot, '.claude/agents/.gitkeep'), '');
  execFileSync('git', ['init', '-q', dot]);
  execFileSync('git', ['-C', dot, 'add', '-A']);
  execFileSync('git', ['-C', dot, 'commit', '-q', '-m', 'init'], { env: GIT_ENV });
  mkdirSync(join(h, '.claude'));
  symlinkSync(join(dot, '.claude/agents'), join(h, '.claude/agents'));
  const r = run(h);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lstatSync(join(dot, '.claude/agents/dev-team-head-pm.md')).isSymbolicLink());
  assert.equal(execFileSync('git', ['-C', dot, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.match(read(join(dot, '.git/info/exclude')), /^\/\.claude\/agents\/dev-team-head-pm\.md$/m);
  assert.equal(run(h).status, 0);
  assert.equal(read(join(dot, '.git/info/exclude')).match(/dev-team-head-pm/g).length, 1);
});

test('uninstall puts ~/.claude back', () => {
  const h = home({ '.claude/settings.json': JSON.stringify({ env: { FOO: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } }) });
  const dot = join(h, 'dotfiles');
  mkdirSync(join(dot, 'agents'), { recursive: true });
  execFileSync('git', ['init', '-q', dot]);
  symlinkSync(join(dot, 'agents'), join(h, '.claude/agents'));
  const excludeBefore = read(join(dot, '.git/info/exclude'));
  assert.equal(run(h).status, 0);
  const r = run(h, '--uninstall');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(join(dot, 'agents')), []);
  for (const p of ['skills/team', 'rules/dev-team.md', 'dev-team', 'dev-team.json']) assert.ok(!lstatExists(join(h, '.claude', p)), p);
  assert.deepEqual(json(join(h, '.claude/settings.json')), { env: { FOO: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } });
  assert.equal(read(join(dot, '.git/info/exclude')), excludeBefore);
});

test('a failure halfway leaves enough behind for --uninstall to clean up', () => {
  const h = home({ '.claude/settings.json': JSON.stringify({ env: { FOO: '1' } }) });
  const dot = join(h, 'dotfiles');
  mkdirSync(join(dot, 'agents'), { recursive: true });
  execFileSync('git', ['init', '-q', dot]);
  symlinkSync(join(dot, 'agents'), join(h, '.claude/agents'));
  const exclude = join(dot, '.git/info/exclude');
  chmodSync(exclude, 0o444); // the last write fails
  const r = run(h);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--uninstall/);
  chmodSync(exclude, 0o644);
  assert.equal(run(h, '--uninstall').status, 0);
  assert.deepEqual(readdirSync(join(dot, 'agents')), []);
  for (const p of ['skills/team', 'rules/dev-team.md', 'dev-team', 'dev-team.json']) assert.ok(!lstatExists(join(h, '.claude', p)), p);
  assert.deepEqual(json(join(h, '.claude/settings.json')), { env: { FOO: '1' } });
});

test('uninstall keeps exclude lines that were there before', () => {
  const h = home();
  const dot = join(h, 'dotfiles');
  mkdirSync(join(dot, 'agents'), { recursive: true });
  execFileSync('git', ['init', '-q', dot]);
  mkdirSync(join(h, '.claude'));
  symlinkSync(join(dot, 'agents'), join(h, '.claude/agents'));
  const exclude = join(dot, '.git/info/exclude');
  writeFileSync(exclude, `${read(exclude)}/agents/dev-team-head-pm.md\n`);
  const before = read(exclude);
  assert.equal(run(h).status, 0);
  assert.equal(run(h, '--uninstall').status, 0);
  assert.equal(read(exclude), before);
});

test('every agent carries the guard, every lead the memory hook', () => {
  const guard = `command: 'node "$HOME/.claude/dev-team/hooks/guard.mjs" || exit 2'`;
  const sync = `command: 'node "$HOME/.claude/dev-team/hooks/sync-memory.mjs"'`;
  for (const f of AGENTS) {
    const fm = read(join(ROOT, 'agents', f)).split('\n---\n')[0];
    assert.match(fm, /^name: dev-team-/m, f);
    assert.match(fm, /matcher: "Bash\|Read\|Grep\|Edit\|Write"/, f);
    assert.ok(fm.includes(guard), f);
    assert.equal(fm.includes(sync), /^memory: local$/m.test(fm), f);
  }
});

test('core.excludesFile set through an include is honoured', () => {
  const h = home({ '.gitconfig': '[include]\n\tpath = ~/.gitconfig.local\n', '.gitconfig.local': '[core]\n\texcludesFile = ~/my-ignore\n' });
  assert.equal(run(h).status, 0);
  assert.match(read(join(h, 'my-ignore')), /^\.team\/$/m);
  assert.ok(!existsSync(join(h, '.config/git/ignore')));
});

test('a manifest entry can only name a link, never .. or the folder above', () => {
  const real = join(home(), 'claude-real');
  const h = home();
  mkdirSync(real);
  symlinkSync(real, join(h, '.claude'));
  writeFileSync(join(real, 'dev-team.json'), JSON.stringify({ links: ['skills/..', 'skills/.', 'agents/../x.md'] }));
  assert.equal(run(h, '--uninstall').status, 0);
  assert.ok(lstatSync(join(h, '.claude')).isSymbolicLink());
});

test('a folder in the way is caught before anything is written', () => {
  const h = home({ '.claude/rules': 'not a folder\n' });
  const before = tree(h);
  const r = run(h);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /rules/);
  assert.deepEqual(tree(h), before);
});

test('install then uninstall on a fresh HOME leaves only the global ignore lines', () => {
  const h = home();
  assert.equal(run(h).status, 0);
  assert.equal(run(h, '--uninstall').status, 0);
  assert.deepEqual(Object.keys(tree(h)), [join('.config', 'git', 'ignore')]);
});

test('uninstall finds its links even without the manifest', () => {
  const h = home();
  assert.equal(run(h).status, 0);
  writeFileSync(join(h, '.claude/dev-team.json'), '{}');
  assert.equal(run(h, '--uninstall').status, 0);
  for (const p of ['agents/dev-team-head-pm.md', 'skills/team', 'rules/dev-team.md', 'dev-team']) assert.ok(!lstatExists(join(h, '.claude', p)), p);
});

test('rejects unknown arguments', () => {
  const h = home();
  const r = run(h, '--force');
  assert.notEqual(r.status, 0);
  assert.deepEqual(tree(h), {});
});
