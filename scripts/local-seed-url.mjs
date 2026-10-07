/** Validate the seed target without constructing a client or opening a connection. */
export function localSeedUrl(connectionString, environment) {
  const url = new URL(connectionString);
  if (
    environment !== 'development' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !['postgres:', 'postgresql:'].includes(url.protocol)
  )
    throw new Error('Demo seed requires a local development PostgreSQL database');
  // pg may let query parameters override the host checked above; allow only Prisma metadata.
  if ([...url.searchParams.keys()].some((key) => key !== 'schema'))
    throw new Error('Demo seed does not allow connection override parameters');
  return url;
}
