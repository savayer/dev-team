---
name: api-contract
description: Template for the backend–frontend contract in `.team/contracts/<feature>.md`. Use when writing, changing or checking an API contract in the head-pm team.
---

# API contract

The contract lives in `.team/contracts/<feature>.md`. It has one author — whoever head-pm assigned in the plan. After the frontend starts only head-pm edits the contract; everyone else puts changes in CONTRACT CHANGES.

Sections in order, an empty section is "none":

1. **Endpoints:** method, path, who is allowed to call it.
2. **Request and response:** fields, types, required-ness, validation constraints — the same for backend and frontend.
3. **Errors:** HTTP status + machine-readable `code` + when it occurs. One error body format for the whole project — use the existing one.
4. **Lists:** pagination (cursor or offset), sorting, filters, max page size.
5. **Mutations:** is a repeated submit idempotent; what happens on partial success in batch operations.
6. **Shared types:** where the types or schema live that the frontend takes them from (not rewritten by hand).
