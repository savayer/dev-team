# AI dev team for Claude Code

```
Owner ↔ main session (plain `claude`)
          └── dev-team-head-pm (in its own worktree)
                ├── dev-team-backend-lead  ── dev-team-senior-engineer / dev-team-middle-engineer
                ├── dev-team-frontend-lead ── dev-team-senior-engineer / dev-team-middle-engineer / dev-team-ui-tester
                ├── dev-team-qa-lead       ── dev-team-senior-engineer / dev-team-middle-engineer / dev-team-ui-tester
                └── dev-team-reviewer      (read-only, before commit)
dev-team-explorer — read-only code search for the PM and the leads
```

You open `claude` in any git repo, type `/team <task>` and walk away. The main session hands it to the PM in a separate git worktree, answers the PM's questions itself and doesn't bother you. At the end you get a pull request from a `team/<task>` branch and one report: what was done, decisions made without you, and the few questions only you can answer, each with a default. Your branches and working copy stay untouched; nothing is merged unless you turn on [merge mode](#merge-mode). Several tasks in one message or while others run: independent ones run in parallel, each in its own worktree; overlapping ones wait until the earlier PR is merged — by you, or by the team in merge mode.

The team is installed once per machine, in `~/.claude`, as links to this repo. Projects need nothing in git.

## What's inside

| File | Purpose |
| --- | --- |
| `rules/dev-team.md` | Team boundaries and a pointer to `/team`, loaded in every session as `~/.claude/rules/dev-team.md` — also visible to the `auto` mode classifier |
| `skills/team/SKILL.md` | `/team` — dispatcher rules: intake, queue, answers, final report. Owner-only (`disable-model-invocation`) |
| `agents/dev-team-head-pm.md` | PM: plans, delegates to leads, accepts work, pushes the branch, opens the PR, one report |
| `agents/dev-team-*-lead.md` | Department leads: breakdown, delegation to engineers, review, integration |
| `agents/dev-team-senior-engineer.md`, `dev-team-middle-engineer.md` | Executors, don't delegate further |
| `agents/dev-team-reviewer.md` | Independent review of the branch diff before commit, security mode for auth/payments/personal data. Edits nothing |
| `agents/dev-team-explorer.md` | Read-only code search, used instead of the built-in `Explore` so the guard covers it |
| `agents/dev-team-ui-tester.md` | Browser smoke test via Playwright MCP (started from the agent's frontmatter via `npx`) |
| `skills/dev-team-protocol/SKILL.md` | Shared protocol: stop list, ambiguity, dependencies, migrations, docs, memory, report format |
| `skills/dev-team-api-contract/SKILL.md` | Backend ↔ frontend contract template |
| `skills/dev-team-auth-safety/SKILL.md`, `dev-team-integrations/SKILL.md` | Checks for auth/permissions and webhooks. Used by the backend lead and the reviewer |
| `hooks/guard.mjs` | Wired into every team agent's frontmatter (Bash, Read, Grep, Edit, Write); anyone else passes untouched. Lets only the PM push its current `team/<name>` branch (`git push -u origin team/<name>`), run `gh pr create` and, in merge mode, merge its own PR (`gh pr merge team/<name> --merge --match-head-commit <sha>`) after checking the branch, the commit, the base and the files — and approves those calls so `auto` mode doesn't stop them. Blocks every other push, merge and `gh` call, publishing, image pushes, `kubectl`/`helm` changes, `terraform`/`tofu`/`pulumi`, hook bypass (`--no-verify`, `core.hooksPath`, `HUSKY=0`), `git stash`, `git send-pack`, and any command or file tool touching `.env*` (except `.env.example`), `*.pem`, `secrets/`. Bans ignore quoted text, so a commit message doesn't trip them |
| `hooks/sync-memory.mjs` | In the leads' frontmatter: copies lead memory from a task's worktree back to the main checkout when a lead finishes |
| `templates/design-system/SKILL.md` | Design system template — copy into a project's `.claude/skills/design-system/` and fill in |
| `install.mjs` | Links the team into `~/.claude`; `~/.claude/dev-team.json` records what it added |

## Install

1. Update Claude Code (`claude update`). You need a version where subagents can launch their own subagents (since v2.1.219). `node` must be installed — the installer and the hooks run on it.
2. Clone this repo once, anywhere: `git clone <this repo's URL> ~/dev-team`.
3. Run `node ~/dev-team/install.mjs` from your own terminal (not through Claude). It:
   - links `agents/*`, `skills/*` and `rules/dev-team.md` into `~/.claude/agents`, `~/.claude/skills` and `~/.claude/rules`, and the repo itself as `~/.claude/dev-team` (the agents' hooks run from there);
   - sets `env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "3"` in `~/.claude/settings.json` — nothing else in that file changes;
   - adds `.claude/worktrees/`, `.claude/agent-memory-local/` and `.team/` to your global git ignore (`core.excludesFile`, or `~/.config/git/ignore`), so no project needs its own;
   - if a link lands inside a git repo (say `~/.claude/agents` is a link into your dotfiles), hides it in that repo's `.git/info/exclude` — its tracked files stay untouched.

   It checks everything before writing. Something else already at a link path, or an invalid `settings.json` — it stops and changes nothing.
4. Install `gh` and run `gh auth login` — the PM opens PRs with it; without it the task ends at a pushed branch.
5. No-questions mode. In your **user** `~/.claude/settings.json` (`auto` is ignored in a project file):
   ```json
   { "permissions": { "defaultMode": "auto" } }
   ```
   Or launch with `--permission-mode auto`. `acceptEdits` doesn't work for this setup: every Bash command of every engineer becomes a prompt to you. Without `auto` — `bypassPermissions`, and only in an isolated container.
   Note: in `auto`, writes to lead memory (`.claude/agent-memory-local/`, the protected `.claude` path) go through the classifier, and after 3 blocks in a row or 20 per session auto pauses and starts asking.
6. Start a new `claude` session: `/agents` lists the `dev-team-*` agents. In a git repo with an `origin`, type `/team <task>`.

**Per project, all optional and never committed:** verification commands in the project's `CLAUDE.md` (below), merge mode in `.claude/settings.local.json` ([below](#merge-mode)), a design system skill copied from `templates/`.

**Update:** `git -C ~/dev-team pull` — edits reach every project at once. Re-run the installer only when the team adds, drops or renames a file; it relinks and removes only its own links. The checkout is live: switching its branch switches the team everywhere, so experiment in a separate worktree of this repo.

**Uninstall:** `node ~/dev-team/install.mjs --uninstall` removes its links (also any link into this repo the manifest lost), restores `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` — or removes it, and `settings.json` too if the install created it — and the exclude lines it added; the global ignore lines stay (harmless). If an install stops halfway, re-run it or run `--uninstall`: the manifest is written before anything else.

**Installed per project before:** that layout is gone. In such a project delete `.claude/agents/{head-pm,backend-lead,frontend-lead,qa-lead,senior-engineer,middle-engineer,reviewer,ui-tester}.md`, `.claude/skills/{team,team-protocol,api-contract,auth-safety,integrations}/`, `.claude/hooks/{guard-push,sync-memory}.mjs`, `.claude/dev-team.json`, the team block in `.claude/CLAUDE.md`, the team's hooks, `env` and allow/deny rules in `.claude/settings.json`, and the `.claude/agent-memory-local/` line in `.worktreeinclude`. Lead memory moves with a rename: `.claude/agent-memory-local/<lead>` → `.claude/agent-memory-local/dev-team-<lead>`.

## What the project CLAUDE.md needs

Nothing is strictly required: without CLAUDE.md the team still works — the PM finds commands in `package.json`/`Makefile`/README and records them in `.team/plan.md`. But with it, results are more precise and cheaper:

1. **Verification commands** — install (one that doesn't rewrite the lockfile: `npm ci` and equivalents), tests, linter, types, build. The most important part: VERIFIED and acceptance depend on them. The worktree is a fresh checkout, so the install command runs on every task.
2. **If there's a UI** — local run command, URL, test login (no real secrets). Without them `dev-team-ui-tester` only checks what's reachable without logging in. It checks only web UI: in a mobile app the team lists UI scenarios for you to check on a device.
3. **Nice to have** — example files (service, endpoint, component, test), stack, structure.

Example:

```markdown
## Commands
- Install: `npm ci`
- Tests: `npm test` · Lint: `npm run lint` · Types: `npm run typecheck` · Build: `npm run build`
- Run: `npm run dev` → http://localhost:3000, test login: `npm run seed` creates demo@example.com
```

## Usage

Type `/team <task>` (several: separate with `;`) and walk away. Without `/team`, `claude` is a normal session and doesn't involve the team. Decisions are logged in `.team/decisions.md` inside the task's worktree and copied into the PR description. At the end — a PR link and a report with a "Questions for you" section where each question already has a default. Answer briefly: "1 — yes, 3 — option B" — the PM does the rework and pushes to the same PR. The report comes in the language you wrote the task in.

## Merge mode

Off by default: the team opens PRs, you merge them, and overlapping tasks wait for your merge.

To turn it on, add to the project's `.claude/settings.local.json` (not committed, this machine only):

```json
{ "env": { "TEAM_MERGE_BRANCH": "develop" } }
```

and start a new `claude` session: the switch is read at session start (check with `printenv TEAM_MERGE_BRANCH`), and `/team` prints "merge mode: on" in its first line. The value must be the team's base (`develop`, or the default branch when there's no `develop`). Never set it to a production branch. Remove the line and start a new session to turn it off.

With it on, the PM merges its own PR with a merge commit once QA and review passed with no critical/major findings, nothing is blocked or skipped, and the branch has caught up with the latest base and re-run the checks green. Open questions don't stop the merge; they're in the report. A PR that touches `.claude/`, `.github/`, `.husky/`, `.mcp.json` or `.worktreeinclude` is never merged by the team. A queued task starts as soon as the earlier PR is merged. Rework of a merged task is a new `/team` task.

Roll back with `git revert -m 1 <merge sha>` (the SHA is in the report), newest merge first.

The hook guards against agent mistakes, not a hostile agent: agents run with your GitHub credentials, and a hook sees only command text. For a hard guarantee use a bot account and branch protection. Overnight: keep the Mac awake — auto mode can pause after repeated classifier denials.

## Customization

- **Seniority = model + effort + task size**, not a persona in the prompt. Leads and senior are on `opus`, middle on `sonnet`. Too expensive — move senior to `sonnet` and give leads `effort: medium`.
- **New department** (DevOps, mobile, data): copy `agents/dev-team-backend-lead.md` to `agents/dev-team-<name>-lead.md`, change `name`, `description`, "Scope" and "Who does what", remove backend specifics (contract, migrations, auth/integrations). Then add the department to the first paragraph and the "You launch only" line of `dev-team-head-pm.md`, the "Hierarchy" line in `dev-team-protocol`, and the diagram at the top of this README, and re-run the installer (a new file needs a new link). Keep the `hooks:` block in its frontmatter — that's what puts the guard on it.
- **Stack knowledge** (API conventions, design system, working with your DB) — as skills in the project's `.claude/skills/`; the team reads them like any project skill. Knowledge for every project goes in this repo's `skills/` (prefix `dev-team-`) and the `skills:` field of the relevant agents. Write them from your own code: only what isn't visible in the code and differs from defaults (patterns, pitfalls, bans), aim for under 60 lines. Don't copy language specialists from ready-made collections — they restate the language, which the model already knows.
- **Deploy commands.** A deploy CLI the team must never run (`vercel --prod`, `fly deploy`, `railway up`, etc.) — add it to `BANS` in `hooks/guard.mjs` (team agents everywhere) or to `permissions.deny` in the project's `.claude/settings.json` (every session in that project).
- **File conflicts.** Parallel engineers in the same files overwrite each other, so leads hand out non-overlapping files.

## Good to know

- The worktree has only tracked files. If the app needs `.env` to run for `dev-team-ui-tester`, list it in a [`.worktreeinclude`](https://code.claude.com/docs/en/worktrees) file.
- Tasks branch off `develop` and open PRs into it when `origin/develop` exists, otherwise off the default branch. No GitHub settings change needed.
- Each level is a separate context and separate tokens. For small things the PM works alone or takes one lead (this is in its prompt).
- `dev-team-ui-tester` pulls `@playwright/mcp` via `npx` on first run; if the browser didn't download itself — `npx playwright install chromium`.
- Better not to install agent collection plugins (e.g. VoltAgent) globally: agents launch others via `Agent` without a list and will see all of them. A project agent with the same name as a team agent replaces it in that project — the `dev-team-` prefix keeps that from happening by accident. "Who launches whom" lives in the prompts: `Agent(...)` lists in subagent frontmatter are ignored.
- Each task's worktree is `.claude/worktrees/agent-<id>` and stays after the task: the PM is resumed there. After merging, remove it with the commands from the final message.
- Lead memory is per project and local (`.claude/agent-memory-local/`, ignored globally): it lives on this machine only. The PM copies it into each task's worktree; a hook copies what leads learn back to the main checkout when they finish.
- Moving from committed memory: copy `.claude/agent-memory/*` into `.claude/agent-memory-local/`, then `git rm -r --cached .claude/agent-memory` and commit.
- At most 3 tasks run at once. The queue lives in the main session: after a restart, queued tasks that hadn't started are lost — resend them.
- The guard checks the command text anywhere in it, so it also fires on a commit message or heredoc that contains `git push`, the word `gh`, `git stash`, `--no-verify`, `terraform` and the like. Rephrase or write the text with the Edit tool. It applies to team agents only: your main session — including while it dispatches `/team` tasks — relies on the rules file and `auto` mode, and so does any agent outside the team a team agent might launch against its prompt. A project agent named like a team agent replaces it in that project, guard included. The guard is a safety net, not a sandbox: for a hard guarantee use the [sandbox](https://code.claude.com/docs/en/sandboxing).
- Your user-level `~/.claude/CLAUDE.md` loads into every agent of the team. The protocol tells them to put team rules first, but a large global file still eats context on every launch, and process rules there (e.g. "always ask the user") can make the main session ask you questions.
- `-p` (headless) mode also works with nested subagents, but there a launching subagent doesn't wait for background children — an interactive session is better for this setup.
