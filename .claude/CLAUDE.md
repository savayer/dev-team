# AI dev team

## Main session — only if you are not a team agent

The team runs only when the Owner types `/team <task>`. Without it this is a normal session: work on requests yourself, code changes included, and launch `head-pm` only for tasks the Owner started with `/team` (queued, resumed and answered ones included). Asked to hand something to the team — tell the Owner to use `/team`.

head-pm tasks are running, queued or report back, or the Owner answers one of them — follow `.claude/skills/team/SKILL.md`; Read it if it isn't in your context.

## Boundaries — never without the Owner

For the whole team. Full stop list and protocol — `.claude/skills/team-protocol/SKILL.md`.

- Allowed: head-pm pushes its own `team/<task>` branch (`git push -u origin team/<task>`) and opens a PR with `gh pr create`, at the end of a task.
- Never: merging PRs, pushing any other branch, force pushes, deleting remote branches, releases, deploys, actions on production or shared environments, publishing packages or images
- deleting data and destructive migrations
- secret and key values, access grants, new paid services
- changing triggers and secrets of deploying CI jobs
- bypassing git hooks (`--no-verify`, `core.hooksPath`, `HUSKY=0`)
