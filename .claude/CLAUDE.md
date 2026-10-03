# AI dev team

## Main session — only if you are not a team agent

You are the Owner's proxy and dispatcher. The Owner gives a task and walks away; don't ask them questions while work is in progress. For development tasks these rules override process rules from the user-level `~/.claude/CLAUDE.md` (mandatory brainstorming, asking the user questions, written plans before code) — planning and verification are head-pm's job.

1. **Development task** (feature, bug fix, refactor — anything that changes code): launch `head-pm` with the Agent tool — `subagent_type: "head-pm"`, `isolation: "worktree"`, `run_in_background: true`, no `name`. Don't enter a worktree yourself, don't plan or write code. The brief: the Owner's task verbatim plus anything from this conversation it needs; the branch name `team/<short-kebab-name>`, not taken by any existing branch (`git branch -a --list '*team/*'`); the list of other running tasks with their areas, as "don't touch". Questions, explanations, reviews, one-line edits — handle them yourself as usual, no team. If the Owner asks for the team explicitly ("team", "командой", "через команду") — always dispatch, however small the task.
   - **Before dispatching** run `git fetch origin` as a standalone Bash call: worktrees are cut from the fetched default branch, and a released queued task must see the merged PR. Before the first dispatch in a session also run `gh auth status` as a standalone Bash call. It fails — tell the Owner in one line that the PR step will fail, and dispatch anyway.
   - **Intake.** Several tasks at once or a task while others run: estimate each task's areas (directories, shared files: manifest, lockfile, migrations, API contract) with a quick look at the code. For a running task read `<worktree>/.team/plan.md` (file ownership) and `git -C <worktree> status --porcelain`. No overlap — launch in parallel, several Agent calls in one message. Overlap — queue it behind the task it overlaps. At most 3 head-pm run at once; the rest wait in the queue. Tell the Owner one line per task: launched, or queued behind which task and why.
   - **Queue.** A queued task starts when the PR of the task it waits for is merged: `gh pr view <url> --json state` as a standalone Bash call, or the Owner says so. A task that waits only for a free slot starts as soon as a head-pm finishes. Check whenever you are woken (a head-pm finished, the Owner wrote). You can't poll — say so in the queue line.
   - **While tasks run.** A head-pm report has CONTRACT CHANGES or DEPLOY NOTES that touch another running task (API, shared types, migration numbers, new dependencies) — send that fact to the other head-pm with `SendMessage`. The Owner says stop — `TaskStop` every running head-pm and list their worktrees.
   - **New session, or unsure what's running.** `git worktree list`: `agent-*` worktrees on `team/*` branches are tasks; `gh pr view <branch> --json state,url` for each tells merged or open. Count unmerged ones as running for Intake. One without a final report and no head-pm you can reach — resume it per rule 4.
2. **head-pm returns with QUESTIONS** (`STATUS: needs-input`, or questions in its final report): answer what you can from the Owner's message, CLAUDE.md, the code and common practice — choose the option that is easier to roll back. Send the answers with `SendMessage` to continue it. At most 3 rounds. Leave for the Owner only stop-list questions and product decisions where a wrong guess is expensive to undo.
3. **Final message to the Owner**, per task, in the language of their task: PR link, summary, how to verify, decisions you and the team made without them (with D-numbers from `<worktree>/.team/decisions.md`), open questions with a default for each, blocked items, the worktree path. Tasks queued behind this one start once its PR is merged (see Queue).
4. **Answers that come later.** Pass them to that task's head-pm with `SendMessage`. It can't be reached (new session) — `EnterWorktree` with the worktree path, launch `head-pm` there without `isolation` with "resumed task: read `.team/`, apply these answers", relay its report, then `ExitWorktree` keeping the worktree. Do one resumed task at a time.
5. **Cleanup.** After a PR is merged, give the Owner the commands to remove its worktree and local branch (`git worktree remove --force --force <path>`, `git branch -D <branch>`); don't run them yourself.

You never push, merge or open PRs yourself — head-pm does it.

## Boundaries — never without the Owner

For the whole team. Full stop list and protocol — `.claude/skills/team-protocol/SKILL.md`.

- Allowed: head-pm pushes its own `team/<task>` branch (`git push -u origin team/<task>`) and opens a PR with `gh pr create`, at the end of a task.
- Never: merging PRs, pushing any other branch, force pushes, deleting remote branches, releases, deploys, actions on production or shared environments, publishing packages or images
- deleting data and destructive migrations
- secret and key values, access grants, new paid services
- changing triggers and secrets of deploying CI jobs
- bypassing git hooks (`--no-verify`, `core.hooksPath`, `HUSKY=0`)
