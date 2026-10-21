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

Type `/team <task>` in any git repo and walk away. The main session hands the task to the PM in its own git worktree and answers the PM's questions itself. You get a PR from a `team/<task>` branch and one report: what was done, decisions made without you, and the few questions only you can answer, each with a default. Your branches and working copy stay untouched; nothing is merged unless you turn on [merge mode](#merge-mode).

Several tasks run in parallel, each in its own worktree, at most 3 at once. Tasks that touch the same files run in parallel only in merge mode; without it the team warns you and waits until you say "now" or "after <task>".

The team is installed once per machine, in `~/.claude`, as links to this repo. Projects need nothing in git.

## What's inside

| Path | Purpose |
| --- | --- |
| `rules/dev-team.md` | Team boundaries, loaded in every session (the `auto` mode classifier sees them too) |
| `skills/team/` | `/team`: intake, queue, answers, final report. Owner-only |
| `agents/dev-team-head-pm.md` | PM: plans, delegates to leads, accepts the work, pushes, opens the PR, reports |
| `agents/dev-team-*-lead.md` | Department leads: breakdown, delegation to engineers, review, integration |
| `agents/dev-team-senior-engineer.md`, `dev-team-middle-engineer.md` | Executors |
| `agents/dev-team-reviewer.md` | Review of the branch diff before commit, security mode for auth/payments/personal data. Edits nothing |
| `agents/dev-team-explorer.md` | Read-only code search, used instead of the built-in `Explore` so the guard covers it |
| `agents/dev-team-ui-tester.md` | Browser smoke test via Playwright MCP |
| `skills/dev-team-*/` | Shared protocol, backend ↔ frontend contract, auth and webhook checks |
| `hooks/guard.mjs` | Guard for team agents only. Only the PM may push its `team/*` branch, open a PR and, in merge mode, merge it (and fast-forward `master`/`main` to that merge). Blocks every other push, merge and `gh` call, publishing, cluster and infrastructure changes, hook bypass, `git stash`, touching `.env*`, `*.pem`, `secrets/` |
| `hooks/sync-memory.mjs` | Copies lead memory from a task's worktree back to the main checkout |
| `hooks/worktree-slot.mjs` | `WorktreeCreate` hook of a [multi-repo workspace](#multi-repo-workspace): an empty slot per isolated agent |
| `hooks/slot-init.mjs` | Run by the PM: turns its slot into a worktree of the task's repo on the base |
| `hooks/merge-branch.mjs` | Merge mode's base for a checkout, shared by the guard, the PM and `/team`: the env in a single repo, the repo's own settings in a multi-repo workspace |
| `templates/design-system/` | Design system skill template — copy into a project's `.claude/skills/design-system/` |
| `install.mjs` | Links the team into `~/.claude` |

## Install

1. `claude update` — subagents must be able to launch subagents (v2.1.219+). Install `node`: the installer and the hooks run on it.
2. `git clone <this repo's URL> ~/dev-team`
3. Run `node ~/dev-team/install.mjs` from your own terminal, not through Claude. It links the agents, skills and rule into `~/.claude`, sets `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3` in `~/.claude/settings.json` and adds `.claude/worktrees/`, `.claude/agent-memory-local/`, `.team/` to your global git ignore. It checks everything first; on any conflict it stops and changes nothing.
4. `gh auth login` — the PM opens PRs with `gh`; without it a task ends at a pushed branch.
5. In your **user** `~/.claude/settings.json` (a project file can't set it): `{ "permissions": { "defaultMode": "auto" } }`, or launch with `--permission-mode auto`. With `acceptEdits` every engineer's Bash command becomes a prompt to you; `bypassPermissions` only in an isolated container.
6. Start a new `claude` session: `/agents` lists `dev-team-*`. In a repo with an `origin`, type `/team <task>`.

**Update:** `git -C ~/dev-team pull`. Re-run the installer only when the team adds, drops or renames a file. The checkout is live — switching its branch switches the team everywhere, so experiment in a separate worktree of this repo.

**Uninstall:** `node ~/dev-team/install.mjs --uninstall` removes its links and settings changes; the global ignore lines stay.

**Old per-project install:** in such a project delete `.claude/agents/{head-pm,backend-lead,frontend-lead,qa-lead,senior-engineer,middle-engineer,reviewer,ui-tester}.md`, `.claude/skills/{team,team-protocol,api-contract,auth-safety,integrations}/`, `.claude/hooks/{guard-push,sync-memory}.mjs`, `.claude/dev-team.json`, the team block in `.claude/CLAUDE.md`, the team's hooks, `env` and permissions in `.claude/settings.json`, and its line in `.worktreeinclude`. Rename lead memory `.claude/agent-memory-local/<lead>` → `dev-team-<lead>`; committed `.claude/agent-memory/` — copy it there and `git rm -r --cached` it.

## What the project CLAUDE.md needs

Nothing is required: without it the PM finds commands in `package.json`, `Makefile` or the README. With it, results are more precise and cheaper:

1. **Verification commands** — install without rewriting the lockfile (`npm ci` and equivalents), tests, linter, types, build. Acceptance depends on them.
2. **If there's a UI** — run command, URL, test login (no real secrets). Web only: for a mobile app the team lists scenarios for you to check on a device.
3. **Nice to have** — example files, stack, structure.

```markdown
## Commands
- Install: `npm ci`
- Tests: `npm test` · Lint: `npm run lint` · Types: `npm run typecheck` · Build: `npm run build`
- Run: `npm run dev` → http://localhost:3000, test login: `npm run seed` creates demo@example.com
```

## Usage

`/team <task>`, several separated by `;`. Without `/team`, `claude` is a normal session. Decisions go to `.team/decisions.md` in the task's worktree and into the PR description. The report ends with "Questions for you", each with a default: answer briefly ("1 — yes, 3 — option B") and the PM reworks the same PR. Rework after a merge is a new `/team` task. The report comes in the language of your task.

## Merge mode

Off by default: the team opens PRs, you merge them. To turn it on, add to the project's `.claude/settings.local.json` (not committed):

```json
{ "env": { "TEAM_MERGE_BRANCH": "develop" } }
```

and start a new session — `/team` prints "merge mode: on" in its first line. The value is the team's base (`develop`, or the default branch when there's no `develop`): the team merges into it only. Or `master`/`main` in a repo with `develop`: the team merges into `develop`, then fast-forwards `master`/`main` to that merge, so both get all the work ("merge mode: on → develop, then master"). Never a branch that deploys on push. Any other value merges nothing. Remove the line and start a new session to turn it off.

The PM then merges its own PR with a merge commit once QA and review passed with no critical/major findings, nothing is blocked, and the branch has caught up with the latest base (and with `master`/`main` when it promotes) — conflicts resolved, checks green again. Open questions don't stop the merge. In a public repo the PM fast-forwards the base to the PR head instead of a GitHub merge commit, which would carry your account's name and email. The promotion is a fast-forward only: when `master`/`main` moved, or `develop` would bring protected files to it, it stays with you and the report says "not promoted". A PR that touches `.claude/`, `.github/`, `.husky/`, `.mcp.json` or `.worktreeinclude` is never merged by the team. Roll back with `git revert -m 1 <merge sha>` (the SHA is in the report), newest merge first; after a fast-forward, revert the task's commits listed in the report.

The guard catches agent mistakes, not a hostile agent: agents run with your GitHub credentials. For a hard guarantee use a bot account and branch protection.

## Multi-repo workspace

One session for several repos kept side by side in a plain folder that isn't a git repo itself:

```
~/work/acme/                      ← run claude here
├── .claude/settings.json         ← the WorktreeCreate hook
├── backend/                      ← git repos, each with an origin
├── frontend/
└── .team-worktrees/agent-<id>/   ← task worktrees, made by the team
```

`/team` picks each task's repo from the ticket and asks when that's unclear. Tasks for different repos run in parallel. Setup:

1. Add the hook to `<workspace>/.claude/settings.json`:
   ```json
   {"hooks":{"WorktreeCreate":[{"hooks":[{"type":"command","command":"node \"$HOME/.claude/dev-team/hooks/worktree-slot.mjs\""}]}]}}
   ```
2. Launch `claude` in the workspace interactively once and trust the folder: hooks of an untrusted folder don't run.
3. Merge mode is per repo: put the `TEAM_MERGE_BRANCH` line into `<repo>/.claude/settings.local.json`. The workspace's own env is ignored, so a repo without the line has merge mode off.

Every isolated agent of the session gets an empty slot `<workspace>/.team-worktrees/agent-<id>`. The PM turns it into a worktree of its repo, on `develop` or the default branch, and copies the repo's `.worktreeinclude` files. The hook only does this for the workspace: sessions opened inside a repo are unaffected.

## Customization

- **Cost.** Seniority is model + effort: leads and senior on `opus`, middle on `sonnet`. Cheaper — senior on `sonnet`, leads on `effort: medium`.
- **New department.** Copy `agents/dev-team-backend-lead.md` to `agents/dev-team-<name>-lead.md`, rewrite `name`, `description`, "Scope" and "Who does what", keep the `hooks:` block (it puts the guard on the agent). Add the department to `dev-team-head-pm.md` (first paragraph and "You launch only"), the "Hierarchy" line of `dev-team-protocol` and the diagram above, then re-run the installer.
- **Stack knowledge.** For one project — skills in its `.claude/skills/`. For every project — `skills/dev-team-*` here plus the agents' `skills:` field. Write only what the code doesn't show, under 60 lines.
- **Deploy CLIs** the team must never run (`vercel --prod`, `fly deploy`, …): add them to `BANS` in `hooks/guard.mjs`, or to `permissions.deny` in a project's `.claude/settings.json`.

## Good to know

- A worktree has only tracked files. If the app needs `.env` for `dev-team-ui-tester`, list it in [`.worktreeinclude`](https://code.claude.com/docs/en/worktrees). No browser for the tester — `npx playwright install chromium`.
- Tasks branch off `develop` when `origin/develop` exists, otherwise off the default branch.
- `git push`, the word `gh` and secret paths trip the guard anywhere in a command, quotes and heredocs included; the other bans skip quoted text. Put such text in a file with the Edit tool. The guard covers team agents only — the main session relies on the rules file and `auto` mode. It doesn't check task scope either: the ban on recording new work (tickets, issues, follow-up PRs) lives in the prompts. It's a safety net, not a [sandbox](https://code.claude.com/docs/en/sandboxing).
- `auto` mode pauses and starts asking after 3 classifier blocks in a row or 20 per session; lead memory writes under `.claude/` go through it. Overnight — keep the Mac awake.
- Each task's worktree (`.claude/worktrees/agent-<id>`) stays after the task so the PM can be resumed; remove it after the merge with the commands from the report.
- The queue lives in the main session: after a restart, tasks that hadn't started are lost — resend them.
- Lead memory is local to this machine: `.claude/agent-memory-local/` in each project, ignored by git.
- Don't install agent collections (e.g. VoltAgent) globally: team agents would see them. A project agent named like a team agent replaces it in that project.
- Your `~/.claude/CLAUDE.md` loads into every team agent: keep it small, and avoid process rules like "always ask the user".
