# audit

v0.1 persists AuditEvent for authentication and critical organization/unit/sector
CRUD. Structure records and their audit event use the same database transaction.
Events contain actor/resource/organization IDs, action and timestamp, without
credentials, tokens or raw personal data. No audit browsing endpoint exists yet.
