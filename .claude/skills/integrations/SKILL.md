---
name: integrations
description: Reliability and security rules for webhooks and external events — receiving, processing, sending. Use when a task or diff touches webhooks, queue handlers, outbound requests to customer URLs.
---

# Webhooks and external events

**Receiving.** Verify the signature over the raw body before parsing, constant-time comparison, a freshness window on the timestamp. Return 2xx only after the event is durably stored or queued; process asynchronously.

**Duplicates and ordering.** Assume every event arrives twice and out of order: store the event id, reject duplicates with a unique constraint in the DB; a stale event (by version or time) never overwrites newer state.

**Loss.** No event is lost silently: unknown type or processing error → logged and dead-lettered.

**Sending to customer URLs.** https only, internal addresses blocked (SSRF), no following redirects, a timeout.

**Tests:** duplicate, wrong order, invalid signature.
