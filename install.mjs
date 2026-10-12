#!/usr/bin/env node
// Links the dev team into ~/.claude: agents, skills, the rules file, and the repo itself (the agents'
// hooks run from ~/.claude/dev-team/hooks). Edits reach every project at once; re-run only after the
// team adds, drops or renames a file.
//   node install.mjs              install or update
//   node install.mjs --uninstall  remove what it added
// Every check runs before the first write: on failure nothing changes. Only symlinks are ever removed.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME;
const CLAUDE = join(HOME ?? '', '.claude');
const ENV = { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3' }; // leads launch engineers: three levels of subagents
const IGNORE = ['.claude/worktrees/', '.claude/agent-memory-local/', '.team/']; // per project, never committed
const LINK = /^(agents\/[^/.][^/]*\.md|skills\/[^/.][^/]*|rules\/dev-team\.md|dev-team)$/; // the only paths it manages

const fail = (msg) => {
  console.error(`dev-team install: ${msg}`);
  process.exit(1);
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const isObject = (v) => v?.constructor === Object;
const lstat = (p) => {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
};
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const parse = (p) => {
  const text = read(p);
  try {
    return text === null ? undefined : JSON.parse(text); // undefined: no file; null: a file saying null
  } catch (e) {
    fail(`${p} is not valid JSON (${e.message}). Fix it and re-run — nothing was changed.`);
  }
};
const inside = (p, dir) => p === dir || p.startsWith(dir + sep);

const args = process.argv.slice(2);
const uninstall = args[0] === '--uninstall';
if (args.length > (uninstall ? 1 : 0)) fail('usage: node install.mjs [--uninstall]');
if (!HOME) fail('HOME is not set');

// --- plan: read and check everything ---

const manifestPath = join(CLAUDE, 'dev-team.json');
let manifest = parse(manifestPath);
if (manifest === undefined) manifest = {};
if (!isObject(manifest)) fail(`${manifestPath} must hold a JSON object. Fix or delete it and re-run — nothing was changed.`);
const recorded = new Set((Array.isArray(manifest.links) ? manifest.links : []).filter((l) => LINK.test(l)));

const want = new Map(); // path under ~/.claude → what it links to
if (!uninstall) {
  for (const f of readdirSync(join(SRC, 'agents')).filter((f) => f.endsWith('.md'))) want.set(`agents/${f}`, join(SRC, 'agents', f));
  for (const d of readdirSync(join(SRC, 'skills')).filter((d) => existsSync(join(SRC, 'skills', d, 'SKILL.md')))) want.set(`skills/${d}`, join(SRC, 'skills', d));
  want.set('rules/dev-team.md', join(SRC, 'rules', 'dev-team.md'));
  want.set('dev-team', SRC);
}

// a link is ours if the last run recorded it or it points into this repo; anything else is never touched
const ours = (rel) => {
  const p = join(CLAUDE, rel);
  return Boolean(lstat(p)?.isSymbolicLink()) && (recorded.has(rel) || inside(resolve(dirname(p), readlinkSync(p)), SRC));
};
const add = [];
const conflicts = [];
for (const [rel, to] of want) {
  const parent = dirname(join(CLAUDE, rel));
  if (existsSync(parent) && !statSync(parent).isDirectory()) {
    conflicts.push(`${rel} (${parent} is not a folder)`);
    continue;
  }
  const st = lstat(join(CLAUDE, rel));
  if (st?.isSymbolicLink() && readlinkSync(join(CLAUDE, rel)) === to) continue;
  if (st && !ours(rel)) conflicts.push(rel);
  else add.push(rel);
}
if (conflicts.length) {
  fail(`these already exist in ${CLAUDE} and aren't the team's links:\n  ${conflicts.join('\n  ')}\nRename or remove them and re-run — nothing was changed.`);
}
// recorded links, plus any link into this repo (a lost or edited manifest doesn't strand them)
const seen = ['rules/dev-team.md', 'dev-team'];
for (const d of ['agents', 'skills']) {
  const dir = join(CLAUDE, d);
  if (existsSync(dir) && statSync(dir).isDirectory()) seen.push(...readdirSync(dir).map((n) => `${d}/${n}`));
}
const drop = [...new Set([...recorded, ...seen])].filter((rel) => LINK.test(rel) && !want.has(rel) && ours(rel));

const warnings = [];
const settingsPath = join(CLAUDE, 'settings.json');
let settings = parse(settingsPath);
if (settings === undefined) settings = {};
if (!isObject(settings) || (settings.env !== undefined && !isObject(settings.env))) {
  fail(`${settingsPath} must be a JSON object, and its "env" an object. Fix it and re-run — nothing was changed.`);
}
const before = isObject(manifest.env) ? manifest.env : {}; // key → its value before the team set it (null: unset)
// what didn't exist before the first install, so uninstall removes it rather than leaving it empty
const created = isObject(manifest.created) ? manifest.created : { settings: !existsSync(settingsPath), env: settings.env === undefined };
const env = { ...settings.env };
const envRecord = {};
for (const [k, prev] of Object.entries(before)) {
  if (!uninstall && k in ENV) continue;
  if (prev === null) delete env[k];
  else env[k] = prev;
}
for (const [k, v] of Object.entries(uninstall ? {} : ENV)) {
  envRecord[k] = k in before ? before[k] : (env[k] ?? null);
  if (env[k] !== undefined && env[k] !== v) warnings.push(`${settingsPath}: env ${k} ${env[k]} → ${v} (the team needs it)`);
  env[k] = v;
}
const nextSettings = { ...settings };
if (Object.keys(env).length || (settings.env !== undefined && !(uninstall && created.env))) nextSettings.env = env;
else delete nextSettings.env;
const removeSettings = uninstall && created.settings && !Object.keys(nextSettings).length && existsSync(settingsPath);
const settingsText = removeSettings || JSON.stringify(nextSettings) === JSON.stringify(settings) ? null : `${JSON.stringify(nextSettings, null, 2)}\n`;

// lines kept in a text file: add the missing ones, drop the given ones, compare trimmed (CRLF-safe)
function lines(text, adds, drops = []) {
  const kept = (text ?? '').split('\n').filter((l) => !drops.includes(l.trim()));
  const have = new Set(kept.map((l) => l.trim()));
  let out = kept.join('\n');
  const missing = adds.filter((l) => !have.has(l));
  if (missing.length) out += `${out && !out.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`;
  return out === (text ?? '') ? null : out;
}

const writes = new Map(); // file → new text

let ignorePath = '';
try {
  ignorePath = git(HOME, 'config', '--global', '--includes', '--type=path', '--get', 'core.excludesFile');
} catch {}
ignorePath ||= join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), 'git', 'ignore');
if (!uninstall) {
  const text = lines(read(ignorePath), IGNORE);
  if (text !== null) writes.set(ignorePath, text);
}

// a link whose folder sits inside a git repo (say ~/.claude/agents → a dotfiles repo): hide it there,
// in that repo's own .git/info/exclude — its tracked files stay as they are
function repoOf(rel) {
  let dir = dirname(join(CLAUDE, rel));
  let rest = [];
  while (!existsSync(dir)) [dir, rest] = [dirname(dir), [dir.slice(dirname(dir).length + 1), ...rest]];
  const real = realpathSync(dir);
  try {
    const top = git(real, 'rev-parse', '--show-toplevel');
    const exclude = resolve(real, git(real, 'rev-parse', '--git-path', 'info/exclude'));
    return [exclude, `/${relative(realpathSync(top), join(real, ...rest, rel.split('/').pop())).split(sep).join('/')}`];
  } catch {
    return null;
  }
}
const excludes = {}; // exclude file → our lines
for (const rel of want.keys()) {
  const found = repoOf(rel);
  if (found) (excludes[found[0]] ??= []).push(found[1]);
}
const recordedExcludes = isObject(manifest.excludes) ? manifest.excludes : {};
const excludeRecord = {}; // only the lines it added: one that was there before stays on uninstall
for (const file of new Set([...Object.keys(recordedExcludes), ...Object.keys(excludes)])) {
  if (!file.endsWith(`${sep}info${sep}exclude`)) continue;
  const old = Array.isArray(recordedExcludes[file]) ? recordedExcludes[file] : [];
  const keep = excludes[file] ?? [];
  const present = new Set((read(file) ?? '').split('\n').map((l) => l.trim()));
  const mine = keep.filter((l) => old.includes(l) || !present.has(l));
  if (mine.length) excludeRecord[file] = mine;
  const text = lines(read(file), keep, old.filter((l) => !keep.includes(l)));
  if (text !== null) writes.set(file, text);
}

// --- write ---

// write-then-rename, through a link to its target (settings.json may live in a dotfiles repo)
function writeAtomic(p, text) {
  const real = existsSync(p) ? realpathSync(p) : p;
  mkdirSync(dirname(real), { recursive: true });
  writeFileSync(`${real}.dev-team.tmp`, text);
  renameSync(`${real}.dev-team.tmp`, real);
}
let source = null;
try {
  source = git(SRC, 'rev-parse', '--short', 'HEAD');
} catch {}
const record = (links, env, excludes) => `${JSON.stringify({ source, links: [...new Set(links)].sort(), env, excludes, created }, null, 2)}\n`;
try {
  // journal first: should a step below fail, a re-run or --uninstall still knows everything it may have touched
  const journalExcludes = { ...recordedExcludes };
  for (const [file, mine] of Object.entries(excludeRecord)) journalExcludes[file] = [...new Set([...(recordedExcludes[file] ?? []), ...mine])];
  if (!uninstall) writeAtomic(manifestPath, record([...recorded, ...want.keys()], { ...before, ...envRecord }, journalExcludes));
  for (const rel of drop) unlinkSync(join(CLAUDE, rel));
  for (const rel of add) {
    const p = join(CLAUDE, rel);
    if (lstat(p)) unlinkSync(p);
    mkdirSync(dirname(p), { recursive: true });
    symlinkSync(want.get(rel), p);
  }
  if (settingsText !== null) writeAtomic(settingsPath, settingsText);
  if (removeSettings) unlinkSync(settingsPath);
  for (const [file, text] of writes) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  if (uninstall) {
    if (existsSync(manifestPath)) unlinkSync(manifestPath);
  } else writeAtomic(manifestPath, record([...want.keys()], envRecord, excludeRecord));
} catch (e) {
  fail(`stopped halfway (${e.message}). Re-run the installer to finish, or run it with --uninstall to undo.`);
}

// --- report ---

const changed = [...drop.map((r) => `removed ${r}`), ...add.map((r) => `linked  ${r}`)];
if (settingsText !== null) changed.push(`updated ${settingsPath}`);
if (removeSettings) changed.push(`removed ${settingsPath}`);
for (const file of writes.keys()) changed.push(`updated ${file}`);
console.log(`dev-team${source ? ` ${source}` : ''} ${uninstall ? 'uninstalled from' : 'installed in'} ${CLAUDE}`);
console.log(changed.length ? `  ${changed.join('\n  ')}` : '  already up to date');
if (warnings.length) console.log(`\nWarnings:\n  ${warnings.join('\n  ')}`);
if (!uninstall && changed.length) {
  console.log(`
Next:
  1. Start a new claude session: /agents should list the dev-team-* agents.
  2. In any git repo with an origin: \`gh auth login\` once, then /team <task>.
  Optional, per project and never committed: TEAM_MERGE_BRANCH in .claude/settings.local.json (merge mode),
  verification commands in the project CLAUDE.md, a design system skill from ${join(SRC, 'templates')}.`);
}
