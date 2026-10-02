---
name: auth-safety
description: Mandatory checks for authentication, session, token and permission code. Use when a task or diff touches login, sessions, JWT/OAuth, roles, multi-tenancy.
---

# Authentication and permission safety

Fail closed: any verification error = deny.

- Permissions are checked on the server, at every entry point, next to the data access. A frontend check is UX only.
- tenant/owner comes from the verified token or session, never from the body or query.
- JWT: signature, `iss`, `aud`, `exp`, `nbf`; algorithm pinned, `alg: none` rejected. Verification in one place.
- OAuth/OIDC: code + PKCE; `state` and `nonce` checked on callback; redirect_uri — exact match against an allowlist.
- Session cookie: `HttpOnly`, `Secure`, `SameSite`; session id rotates after login and permission changes; logout kills the session on the server.
- Password reset tokens and magic links — single-use and short-lived.

Mandatory tests: another tenant → 403/404; expired or forged token → 401; reused code or link → denied.
