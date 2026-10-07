# identity

Cookie sessions: POST /auth/sessions, GET/DELETE /auth/session and
PUT /auth/session/organization. Tokens are random, hashed in the database,
revocable and expire after eight hours. Authentication reloads database membership
on each request; writes require exact Origin and ADMIN where applicable.
Password hashing uses Node scrypt. Public registration is outside v0.1.
