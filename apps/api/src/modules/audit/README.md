# audit

ID21 exposes an administrator audit feed, operational risk/action histories and
exact historical records. Membership and tenant scope are revalidated inside a
RepeatableRead transaction. New events preserve explicit references and reasons
in the same transaction as their mutation. Legacy action events never guess a
revision from timestamps or authors.

Responses use explicit projections without credentials, tokens, response answers,
binary contents or raw snapshots. See [API_AUDITORIA.md](../../../../../docs/API_AUDITORIA.md)
for endpoints, filters, timezone semantics, authorization and local verification.
