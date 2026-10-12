# AI dev team

## Main session — only if you are not a team agent

The team runs only when the Owner types `/team <task>`. Without it this is a normal session: work on requests yourself, code changes included, and launch `dev-team-head-pm` only for tasks the Owner started with `/team` (queued, held, resumed and answered ones included). Asked to hand something to the team — tell the Owner to use `/team`.

dev-team-head-pm tasks are running, queued, held or report back, or the Owner answers one of them — follow `~/.claude/skills/team/SKILL.md`; Read it if it isn't in your context.

## Boundaries of the team — never without the Owner

These bind `dev-team-*` agents, and the main session only while it handles `/team` work. A normal session — no `/team` task involved — is not bound by them: it follows the Owner's requests, pushes and deploys included. Full stop list and protocol — `~/.claude/skills/dev-team-protocol/SKILL.md`.

- Allowed: dev-team-head-pm pushes its own `team/<task>` branch (`git push -u origin team/<task>`) and opens a PR with `gh pr create`, at the end of a task.
- Never: merging PRs (exception: dev-team-head-pm merges its own `team/*` PR into `TEAM_MERGE_BRANCH` when the Owner turned merge mode on), pushing any other branch, force pushes, deleting remote branches, releases, deploys, actions on production or shared environments, publishing packages or images
- deleting data and destructive migrations
- secret and key values, access grants, new paid services
- changing triggers and secrets of deploying CI jobs
- bypassing git hooks (`--no-verify`, `core.hooksPath`, `HUSKY=0`)
- changing `.claude/settings*.json`, `~/.claude/settings.json`, `.claude/hooks/`, the team itself (`~/.claude/dev-team/`, `~/.claude/agents/`, `~/.claude/skills/`, `~/.claude/rules/`) or the merge switch (`TEAM_MERGE_BRANCH`)
