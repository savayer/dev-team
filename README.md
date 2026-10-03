# AI dev team for Claude Code

```
Owner ↔ main session (plain `claude`)
          └── head-pm (in its own worktree)
                ├── backend-lead  ── senior-engineer / middle-engineer
                ├── frontend-lead ── senior-engineer / middle-engineer / ui-tester
                ├── qa-lead       ── senior-engineer / middle-engineer / ui-tester
                └── reviewer      (read-only, before commit)
```

You open `claude`, type `/team <task>` and walk away. The main session hands it to the PM in a separate git worktree, answers the PM's questions itself and doesn't bother you. At the end you get a pull request from a `team/<task>` branch and one report: what was done, decisions made without you, and the few questions only you can answer, each with a default. Your branches and working copy stay untouched; nothing is merged. Several tasks in one message or while others run: independent ones run in parallel, each in its own worktree; overlapping ones wait until the earlier PR is merged.

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
| `.claude/hooks/guard-push.mjs` | Lets only head-pm push its current `team/<name>` branch (`git push -u origin team/<name>`) and run `gh pr create`; blocks every other push, merges and `gh` calls |
| `.claude/settings.json` | Nesting depth 3, the hook, allow rules for the PM's push and PR, deny rules for publish/deploy commands, `git stash`, hook bypass (`--no-verify`, `core.hooksPath`, `HUSKY=0`) and reading `.env` |

## Install

1. Update Claude Code (`claude update`). You need a version where subagents can launch their own subagents (since v2.1.219). `node` must be installed — the hook runs on it.
2. Copy `.claude/` into the project root. If `settings.json` or `CLAUDE.md` already exist there — merge by hand.
3. Add `.claude/worktrees/` and `.team/` to the project's `.gitignore`. Commit `.claude/` and push it to the default branch yourself, from your terminal (once the hook is in place, Claude can push only head-pm's `team/*` branches). The PM's worktree is cut from `origin`'s default branch, so without this the worktree has no team, hook or rules — and later edits to `.claude/` reach the team only after they're on that branch.
4. Check the project's `CLAUDE.md` against "What the project CLAUDE.md needs" below. If there's a frontend — fill in `.claude/skills/design-system/SKILL.md`.
5. Install `gh` and run `gh auth login` — the PM opens PRs with it; without it the task ends at a pushed branch.
6. No-questions mode. In your **user** `~/.claude/settings.json` (`auto` is ignored in the project file):
   ```json
   { "permissions": { "defaultMode": "auto" } }
   ```
   Or launch with `--permission-mode auto`. `acceptEdits` doesn't work for this setup: every Bash command of every engineer becomes a prompt to you. Without `auto` — `bypassPermissions`, and only in an isolated container.
   Note: in `auto`, writes to lead memory (`.claude/agent-memory/`, the protected `.claude` path) go through the classifier, and after 3 blocks in a row or 20 per session auto pauses and starts asking.
7. Open the project in `claude` interactively once and confirm folder trust — otherwise the project allow rules and the inline MCP of `ui-tester` won't work.
8. Run `claude` and type `/team <task>`.

## What the project CLAUDE.md needs

Nothing is strictly required: without CLAUDE.md the team still works — the PM finds commands in `package.json`/`Makefile`/README and records them in `.team/plan.md`. But with it, results are more precise and cheaper:

1. **Verification commands** — install (one that doesn't rewrite the lockfile: `npm ci` and equivalents), tests, linter, types, build. The most important part: VERIFIED and acceptance depend on them. The worktree is a fresh checkout, so the install command runs on every task.
2. **If there's a UI** — local run command, URL, test login (no real secrets). Without them `ui-tester` only checks what's reachable without logging in.
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

## Customization

- **Seniority = model + effort + task size**, not a persona in the prompt. Leads and senior are on `opus`, middle on `sonnet`. Too expensive — move senior to `sonnet` and give leads `effort: medium`.
- **New department** (DevOps, mobile, data): copy `backend-lead.md`, change `name`, `description`, "Scope" and "Who does what", remove backend specifics (contract, migrations, auth/integrations). Then add the department to the first paragraph and the "You launch only" line of `head-pm.md`, the "Hierarchy" line in `team-protocol`, and the diagram at the top of this README.
- **Stack knowledge** (API conventions, design system, working with your DB) — as separate skills in `.claude/skills/` and in the `skills:` field of the relevant agents. Write them from your own code: only what isn't visible in the code and differs from defaults (patterns, pitfalls, bans), aim for under 60 lines. Don't copy language specialists from ready-made collections — they restate the language, which the model already knows.
- **Project deploy commands.** If the project has its own deploy CLI (`vercel --prod`, `fly deploy`, `railway up`, etc.) — add it to `permissions.deny`.
- **File conflicts.** Parallel engineers in the same files overwrite each other, so leads hand out non-overlapping files.

## Good to know

- The worktree has only tracked files. If the app needs `.env` to run for `ui-tester`, list it in a [`.worktreeinclude`](https://code.claude.com/docs/en/worktrees) file.
- The worktree and PR branch off the repository's default branch. If you integrate into `develop`, make it the default branch on the remote.
- Each level is a separate context and separate tokens. For small things the PM works alone or takes one lead (this is in its prompt).
- `ui-tester` pulls `@playwright/mcp` via `npx` on first run; if the browser didn't download itself — `npx playwright install chromium`.
- Better not to install agent collection plugins (e.g. VoltAgent) globally: agents launch others via `Agent` without a list and will see all of them. "Who launches whom" lives in the prompts: `Agent(...)` lists in subagent frontmatter are ignored.
- Each task's worktree is `.claude/worktrees/agent-<id>` and stays after the task: the PM is resumed there. After merging, remove it with the commands from the final message.
- Lead memory travels through PRs; two parallel PRs may conflict on one line of `MEMORY.md` — keep both lines.
- At most 3 tasks run at once. The queue lives in the main session: after a restart, queued tasks that hadn't started are lost — resend them.
- The hook and the deny rules check the command text, so they also fire on a commit message or heredoc that contains `git push`, `/gh `, `git stash` or `--no-verify`. Rephrase or write the text with the Edit tool. Deny rules start with `*` on purpose: a hook that rewrites commands (a wrapper prefix) makes prefix-anchored rules miss. Deny rules and the hook are a safety net, not a sandbox: for a hard guarantee use the [sandbox](https://code.claude.com/docs/en/sandboxing).
- Your user-level `~/.claude/CLAUDE.md` loads into every agent of the team. The protocol tells them to put team rules first, but a large global file still eats context on every launch, and process rules there (e.g. "always ask the user") can make the main session ask you questions.
- `-p` (headless) mode also works with nested subagents, but there a launching subagent doesn't wait for background children — an interactive session is better for this setup.
