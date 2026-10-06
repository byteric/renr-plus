/** Validate the database target before integration fixtures construct a client. */
export function localDatabaseUrl(connectionString: string): URL {
  const url = new URL(connectionString);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['postgres:', 'postgresql:'].includes(url.protocol)
  )
    throw new Error('Integration tests require local PostgreSQL');
  // The driver may override the hostname through the query; allow only Prisma metadata.
  if ([...url.searchParams.keys()].some((key) => key !== 'schema'))
    throw new Error('Integration tests do not allow connection override parameters');
  return url;
}
