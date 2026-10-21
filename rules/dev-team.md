# AI dev team

## Main session — only if you are not a team agent

The team runs only when the Owner types `/team <task>`. Without it this is a normal session: work on requests yourself, code changes included, and launch `dev-team-head-pm` only for tasks the Owner started with `/team` (queued, held, resumed and answered ones included). Asked to hand something to the team — tell the Owner to use `/team`.

Exception — a CLAUDE.md of the session dir or a parent dir has the line `dev-team: self-launch`: there you may also start a team task yourself, for work the Owner asked for in any wording (never for work nobody asked for); asked to hand something to the team — start it. Handle it exactly as if the Owner had typed `/team <task>`: Read `~/.claude/skills/team/SKILL.md` and follow it (pre-dispatch checks, merge-mode line, Intake, running-task limit, held tasks wait for the Owner's word), and the Boundaries below apply. Self-launch grants no merge authority.

dev-team-head-pm tasks are running, queued, held or report back, or the Owner answers one of them — follow `~/.claude/skills/team/SKILL.md`; Read it if it isn't in your context.

## Boundaries of the team — never without the Owner

These bind `dev-team-*` agents, and the main session only while it handles `/team` work. A normal session — no `/team` task involved — is not bound by them: it follows the Owner's requests, pushes and deploys included. Full stop list and protocol — `~/.claude/skills/dev-team-protocol/SKILL.md`.

- Allowed: dev-team-head-pm pushes its own `team/<task>` branch (`git push -u origin team/<task>`) and opens a PR with `gh pr create`, at the end of a task.
- Never: merging PRs (exception: dev-team-head-pm merges its own `team/*` PR into its base when the Owner turned merge mode on — `TEAM_MERGE_BRANCH` is the base, or `master`/`main` over a `develop` base, which also fast-forwards `master`/`main` to that merge), pushing any other branch, force pushes, deleting remote branches, releases, deploys, actions on production or shared environments, publishing packages or images
- deleting data and destructive migrations
- secret and key values, access grants, new paid services
- changing triggers and secrets of deploying CI jobs
- bypassing git hooks (`--no-verify`, `core.hooksPath`, `HUSKY=0`)
- artificial CPU or memory load, stress runs and test loops on the Owner's machine, asking for them in a `/team` brief included (limits — protocol, "Machine resources")
- changing `.claude/settings*.json`, `~/.claude/settings.json`, `.claude/hooks/`, the team itself (`~/.claude/dev-team/`, `~/.claude/agents/`, `~/.claude/skills/`, `~/.claude/rules/`) or the merge switch (`TEAM_MERGE_BRANCH`)
- recording work beyond the task the Owner gave: tracker tickets, issues, new TODO/FIXME comments that defer work, backlog files or notes, branches or PRs other than the task's own `team/*` one. Findings go into reports and the final message; the Owner decides what gets recorded
