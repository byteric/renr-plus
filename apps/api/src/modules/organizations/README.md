# organizations

v0.1 organization/unit/sector persistence. Lists are paginated and bounded.
The organization picker lists all authorized memberships; resource queries and
mutations are restricted to the active organization. ADMIN writes, READER reads.
Critical writes and audit events share a transaction; case-insensitive duplicate
names return 409. Input organization IDs in child bodies are rejected.
