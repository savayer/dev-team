# AI dev team for Claude Code

```
Owner ↔ head-pm (main session)
          ├── backend-lead  ── senior-engineer / middle-engineer
          ├── frontend-lead ── senior-engineer / middle-engineer / ui-tester
          ├── qa-lead       ── senior-engineer / middle-engineer / ui-tester
          └── reviewer      (read-only, before commit)
```

You chat with the PM, give it a task and walk away. It doesn't bother you along the way: it resolves ambiguity itself and logs decisions. At the end you get one report with questions, each with a default already chosen.

## What's inside

| File | Purpose |
| --- | --- |
| `.claude/agents/head-pm.md` | PM: plans, delegates to leads, accepts work, one final report with questions |
| `.claude/agents/*-lead.md` | Department leads: breakdown, delegation to engineers, review, integration |
| `.claude/agents/senior-engineer.md`, `middle-engineer.md` | Executors, don't delegate further |
| `.claude/agents/reviewer.md` | Independent review of the branch diff before commit, security mode for auth/payments/personal data. Edits nothing |
| `.claude/agents/ui-tester.md` | Browser smoke test via Playwright MCP (started from the agent's frontmatter via `npx`) |
| `.claude/skills/team-protocol/SKILL.md` | Shared protocol: stop list, ambiguity, dependencies, migrations, docs, memory, report format. Preloaded into leads and engineers |
| `.claude/skills/api-contract/SKILL.md` | Backend ↔ frontend contract template |
| `.claude/skills/auth-safety/SKILL.md`, `integrations/SKILL.md` | Checks for auth/permissions and webhooks. Used by backend-lead and reviewer |
| `.claude/skills/design-system/SKILL.md` | Design system template — fill in for your project |
| `.claude/settings.json` | Nesting depth 2, deny rules for push/publish/deploy commands, `--no-verify` and reading `.env` |
| `.claude/CLAUDE.md` | Team boundaries (stop list) — visible to the `auto` mode classifier. Leaves the project's root `CLAUDE.md` alone |

## Install

1. Update Claude Code (`claude update`). You need a version where subagents can launch their own subagents (up to 3 levels by default — since v2.1.219).
2. Copy `.claude/` into the project root. If `settings.json` or `CLAUDE.md` already exist there — merge by hand.
3. Check the project's `CLAUDE.md` against "What the project CLAUDE.md needs" below. If there's a frontend — fill in `.claude/skills/design-system/SKILL.md`.
4. No-questions mode. In your **user** `~/.claude/settings.json` (`auto` is ignored in the project file):
   ```json
   { "permissions": { "defaultMode": "auto" } }
   ```
   Or launch with `--permission-mode auto`. `acceptEdits` doesn't work for this setup: every Bash command of every engineer becomes a prompt to you. Without `auto` — `bypassPermissions`, and only in an isolated container.
   Note: in `auto`, writes to lead memory (`.claude/agent-memory/`, the protected `.claude` path) go through the classifier, and after 3 blocks in a row or 20 per session auto pauses and starts asking.
5. Open the project in `claude` interactively once and confirm folder trust — otherwise the inline MCP of `ui-tester` won't start (auto-trust in `-p` doesn't count).
6. Run:
   ```bash
   claude --agent head-pm
   ```
   To make the PM the default session: `"agent": "head-pm"` in `.claude/settings.local.json` (not the shared `settings.json`). Then for regular work — `claude --agent claude`.

## What the project CLAUDE.md needs

Nothing is strictly required: without CLAUDE.md the team still works — the PM finds commands in `package.json`/`Makefile`/README and records them in `.team/plan.md`. But with it, results are more precise and cheaper:

1. **Verification commands** — install (one that doesn't rewrite the lockfile: `npm ci` and equivalents), tests, linter, types, build. The most important part: VERIFIED and acceptance depend on them.
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

Write the task to the PM as usual and walk away. It resolves ambiguity itself and logs decisions to `.team/decisions.md`. At the end — one report with a "Questions for you" section where each question already has a default. Answer briefly: "1 — yes, 3 — option B", and the PM hands out the rework. The report comes in the language you wrote the task in.

`.team/decisions.md` is worth committing — it's the team's decision log.

## Customization

- **Seniority = model + effort + task size**, not a persona in the prompt. Leads and senior are on `opus`, middle on `sonnet`. Too expensive — move senior to `sonnet` and give leads `effort: medium`.
- **New department** (DevOps, mobile, data): copy `backend-lead.md`, change `name`, `description`, "Scope" and "Who does what", remove backend specifics (contract, migrations, auth/integrations). Then add the department to `Agent(...)` and the first paragraph of `head-pm.md`, the "Hierarchy" line in `team-protocol`, and the diagram at the top of this README.
- **Stack knowledge** (API conventions, design system, working with your DB) — as separate skills in `.claude/skills/` and in the `skills:` field of the relevant agents. Write them from your own code: only what isn't visible in the code and differs from defaults (patterns, pitfalls, bans), aim for under 60 lines. Don't copy language specialists from ready-made collections — they restate the language, which the model already knows.
- **Project deploy commands.** If the project has its own deploy CLI (`vercel --prod`, `fly deploy`, `railway up`, etc.) — add it to `permissions.deny`.
- **File conflicts.** Parallel engineers in the same files overwrite each other, so leads hand out non-overlapping files. For full isolation you can give engineers `isolation: worktree`, but a worktree branches off the main branch, not the current one, and merging falls on the lead.

## Good to know

- `--agent head-pm` replaces Claude Code's default system prompt with the PM prompt. Fine for an orchestrator; for regular work just run `claude`.
- Each level is a separate context and separate tokens. For small things the PM works alone or takes one lead (this is in its prompt).
- `ui-tester` pulls `@playwright/mcp` via `npx` on first run; if the browser didn't download itself — `npx playwright install chromium`.
- Better not to install agent collection plugins (e.g. VoltAgent) globally: leads launch agents via `Agent` without a list and will see all of them. The "lead launches only its engineers" restriction lives in the prompt: `Agent(...)` in subagent frontmatter doesn't work, and `Agent(...)` in `permissions.deny` would disable those agents in your regular sessions in the project too.
- Bash deny rules are a safety net, not a security boundary: other invocation forms (`/usr/bin/git push`, `sh -c '…'`) bypass them. The main barrier in `auto` is the team boundaries in `.claude/CLAUDE.md`, which the classifier sees. For a hard guarantee — a PreToolUse hook matching the full command by regex, or a sandbox.
- Your user-level `~/.claude/CLAUDE.md` loads into every agent of the team. The protocol tells them to put team rules first, but a large global file still eats context on every launch.
- `-p` (headless) mode also works with nested subagents, but there a launching subagent doesn't wait for background children — an interactive session is better for this setup.
- Alternative — agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, experimental): leads become teammates and talk to each other directly. Teammates can't create their own teammates but can launch subagents, so engineers stay subagents of leads.
