/** Validate destructive test targets before constructing a database client. */
export function localDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !['postgres:', 'postgresql:'].includes(url.protocol)
  )
    throw new Error('Testes permitidos somente em PostgreSQL local.');
  // pg can override the validated host through query parameters; only Prisma metadata is allowed.
  if ([...url.searchParams.keys()].some((key) => key !== 'schema'))
    throw new Error('Testes locais não permitem parâmetros de conexão adicionais.');
  return url;
}
