# AI dev team for Claude Code

```
Owner ↔ main session (plain `claude`)
          └── head-pm (in its own worktree)
                ├── backend-lead  ── senior-engineer / middle-engineer
                ├── frontend-lead ── senior-engineer / middle-engineer / ui-tester
                ├── qa-lead       ── senior-engineer / middle-engineer / ui-tester
                └── reviewer      (read-only, before commit)
```

You open `claude`, type `/team <task>` and walk away. The main session hands it to the PM in a separate git worktree, answers the PM's questions itself and doesn't bother you. At the end you get a pull request from a `team/<task>` branch and one report: what was done, decisions made without you, and the few questions only you can answer, each with a default. Your branches and working copy stay untouched; nothing is merged unless you turn on [merge mode](#merge-mode). Several tasks in one message or while others run: independent ones run in parallel, each in its own worktree; overlapping ones wait until the earlier PR is merged — by you, or by the team in merge mode.

## What's inside

| File | Purpose |
| --- | --- |
| `.claude/CLAUDE.md` | Team boundaries and a pointer to `/team` — also visible to the `auto` mode classifier |
| `.claude/skills/team/SKILL.md` | `/team` — dispatcher rules: intake, queue, answers, final report. Owner-only (`disable-model-invocation`) |
| `.claude/agents/head-pm.md` | PM: plans, delegates to leads, accepts work, pushes the branch, opens the PR, one report |
| `.claude/agents/*-lead.md` | Department leads: breakdown, delegation to engineers, review, integration |
| `.claude/agents/senior-engineer.md`, `middle-engineer.md` | Executors, don't delegate further |
| `.claude/agents/reviewer.md` | Independent review of the branch diff before commit, security mode for auth/payments/personal data. Edits nothing |
| `.claude/agents/ui-tester.md` | Browser smoke test via Playwright MCP (started from the agent's frontmatter via `npx`) |
| `.claude/skills/team-protocol/SKILL.md` | Shared protocol: stop list, ambiguity, dependencies, migrations, docs, memory, report format |
| `.claude/skills/api-contract/SKILL.md` | Backend ↔ frontend contract template |
| `.claude/skills/auth-safety/SKILL.md`, `integrations/SKILL.md` | Checks for auth/permissions and webhooks. Used by backend-lead and reviewer |
| `.claude/skills/design-system/SKILL.md` | Design system template — fill in for your project |
| `.claude/hooks/guard-push.mjs` | Lets only head-pm push its current `team/<name>` branch (`git push -u origin team/<name>`), run `gh pr create` and, in merge mode, merge its own PR (`gh pr merge team/<name> --merge --match-head-commit <sha>`) after checking the branch, the commit, the base and the files; blocks every other push, merge and `gh` call |
| `.claude/hooks/sync-memory.mjs` | Copies lead memory from a task's worktree back to the main checkout when a lead finishes |
| `.claude/.gitignore` | Keeps task worktrees and the leads' local memory out of git |
| `.claude/settings.json` | Nesting depth 3, the hooks, allow rules for the PM's push, PR and merge, deny rules for publish/deploy commands, `git stash`, hook bypass (`--no-verify`, `core.hooksPath`, `HUSKY=0`) and reading `.env` |

## Install

1. Update Claude Code (`claude update`). You need a version where subagents can launch their own subagents (since v2.1.219). `node` must be installed — the hooks run on it.
2. Copy `.claude/` into the project root. If `settings.json` or `CLAUDE.md` already exist there — merge by hand.
3. Add `.team/` to the project's `.gitignore` (`.claude/.gitignore` already keeps task worktrees and the leads' local memory out of git). Create `.worktreeinclude` in the project root with the line `.claude/agent-memory-local/` — it seeds each task's worktree with the leads' memory. Commit `.claude/` and `.gitignore` and push them to `develop` (or the default branch if the repo has no `develop`) yourself, from your terminal (once the hook is in place, Claude can push only head-pm's `team/*` branches). The PM's worktree starts from that branch, so without this the worktree has no team, hook or rules — and later edits to `.claude/` reach the team only after they're on that branch.
4. Check the project's `CLAUDE.md` against "What the project CLAUDE.md needs" below. If there's a frontend — fill in `.claude/skills/design-system/SKILL.md`.
5. Install `gh` and run `gh auth login` — the PM opens PRs with it; without it the task ends at a pushed branch.
6. No-questions mode. In your **user** `~/.claude/settings.json` (`auto` is ignored in the project file):
   ```json
   { "permissions": { "defaultMode": "auto" } }
   ```
   Or launch with `--permission-mode auto`. `acceptEdits` doesn't work for this setup: every Bash command of every engineer becomes a prompt to you. Without `auto` — `bypassPermissions`, and only in an isolated container.
   Note: in `auto`, writes to lead memory (`.claude/agent-memory-local/`, the protected `.claude` path) go through the classifier, and after 3 blocks in a row or 20 per session auto pauses and starts asking.
7. Open the project in `claude` interactively once and confirm folder trust — otherwise the project allow rules and the inline MCP of `ui-tester` won't work.
8. Run `claude` and type `/team <task>`.

## What the project CLAUDE.md needs

Nothing is strictly required: without CLAUDE.md the team still works — the PM finds commands in `package.json`/`Makefile`/README and records them in `.team/plan.md`. But with it, results are more precise and cheaper:

1. **Verification commands** — install (one that doesn't rewrite the lockfile: `npm ci` and equivalents), tests, linter, types, build. The most important part: VERIFIED and acceptance depend on them. The worktree is a fresh checkout, so the install command runs on every task.
2. **If there's a UI** — local run command, URL, test login (no real secrets). Without them `ui-tester` only checks what's reachable without logging in. `ui-tester` checks only web UI: in a mobile app the team lists UI scenarios for you to check on a device.
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

With it on, head-pm merges its own PR with a merge commit once QA and review passed with no critical/major findings, nothing is blocked or skipped, and the branch has caught up with the latest base and re-run the checks green. Open questions don't stop the merge; they're in the report. A PR that touches `.claude/`, `.github/`, `.husky/`, `.mcp.json` or `.worktreeinclude` is never merged by the team. A queued task starts as soon as the earlier PR is merged. Rework of a merged task is a new `/team` task.

Roll back with `git revert -m 1 <merge sha>` (the SHA is in the report), newest merge first.

The hook guards against agent mistakes, not a hostile agent: agents run with your GitHub credentials, and a hook sees only command text. For a hard guarantee use a bot account and branch protection. Overnight: keep the Mac awake — auto mode can pause after repeated classifier denials.

## Customization

- **Seniority = model + effort + task size**, not a persona in the prompt. Leads and senior are on `opus`, middle on `sonnet`. Too expensive — move senior to `sonnet` and give leads `effort: medium`.
- **New department** (DevOps, mobile, data): copy `backend-lead.md`, change `name`, `description`, "Scope" and "Who does what", remove backend specifics (contract, migrations, auth/integrations). Then add the department to the first paragraph and the "You launch only" line of `head-pm.md`, the "Hierarchy" line in `team-protocol`, and the diagram at the top of this README.
- **Stack knowledge** (API conventions, design system, working with your DB) — as separate skills in `.claude/skills/` and in the `skills:` field of the relevant agents. Write them from your own code: only what isn't visible in the code and differs from defaults (patterns, pitfalls, bans), aim for under 60 lines. Don't copy language specialists from ready-made collections — they restate the language, which the model already knows.
- **Project deploy commands.** If the project has its own deploy CLI (`vercel --prod`, `fly deploy`, `railway up`, etc.) — add it to `permissions.deny`.
- **File conflicts.** Parallel engineers in the same files overwrite each other, so leads hand out non-overlapping files.

## Good to know

- The worktree has only tracked files. If the app needs `.env` to run for `ui-tester`, list it in a [`.worktreeinclude`](https://code.claude.com/docs/en/worktrees) file.
- Tasks branch off `develop` and open PRs into it when `origin/develop` exists, otherwise off the default branch. No GitHub settings change needed.
- Each level is a separate context and separate tokens. For small things the PM works alone or takes one lead (this is in its prompt).
- `ui-tester` pulls `@playwright/mcp` via `npx` on first run; if the browser didn't download itself — `npx playwright install chromium`.
- Better not to install agent collection plugins (e.g. VoltAgent) globally: agents launch others via `Agent` without a list and will see all of them. "Who launches whom" lives in the prompts: `Agent(...)` lists in subagent frontmatter are ignored.
- Each task's worktree is `.claude/worktrees/agent-<id>` and stays after the task: the PM is resumed there. After merging, remove it with the commands from the final message.
- Lead memory is local (`.claude/agent-memory-local/`, not committed): it lives on this machine only. A hook copies what leads learn in a task back to the main checkout when they finish.
- Moving from committed memory: copy `.claude/agent-memory/*` into `.claude/agent-memory-local/`, then `git rm -r --cached .claude/agent-memory` and commit.
- At most 3 tasks run at once. The queue lives in the main session: after a restart, queued tasks that hadn't started are lost — resend them.
- The hook and the deny rules check the command text, so they also fire on a commit message or heredoc that contains `git push`, the word `gh`, `git stash` or `--no-verify`. Rephrase or write the text with the Edit tool. Deny rules start with `*` on purpose: a hook that rewrites commands (a wrapper prefix) makes prefix-anchored rules miss. Deny rules and the hook are a safety net, not a sandbox: for a hard guarantee use the [sandbox](https://code.claude.com/docs/en/sandboxing).
- Your user-level `~/.claude/CLAUDE.md` loads into every agent of the team. The protocol tells them to put team rules first, but a large global file still eats context on every launch, and process rules there (e.g. "always ask the user") can make the main session ask you questions.
- `-p` (headless) mode also works with nested subagents, but there a launching subagent doesn't wait for background children — an interactive session is better for this setup.
