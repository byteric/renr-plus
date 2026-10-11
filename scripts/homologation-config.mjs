export function homologationConfig(env) {
  if (env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production');
  if (env.ALLOW_HOMOLOGATION_PROVISION !== 'true')
    throw new Error('Set ALLOW_HOMOLOGATION_PROVISION=true for this manual operation');
  let url;
  try {
    url = new URL(env.DATABASE_URL_UNPOOLED);
  } catch {
    throw new Error('DATABASE_URL_UNPOOLED must be a direct PostgreSQL URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.hash
  )
    throw new Error('DATABASE_URL_UNPOOLED must be a direct PostgreSQL URL');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !database ||
    database.includes('/') ||
    url.hostname.includes('-pooler') ||
    url.searchParams.get('pgbouncer') === 'true'
  )
    throw new Error('Use the direct database endpoint');
  if (url.searchParams.get('sslmode') !== 'verify-full' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('Strict TLS verification (sslmode=verify-full) is required');
  const allowedParameters = new Set(['sslmode', 'channel_binding', 'schema', 'connect_timeout']);
  if (
    [...url.searchParams.keys()].some(
      (key) => !allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1,
    )
  )
    throw new Error('Unsupported database URL parameters');
  if (
    env.HOMOLOGATION_CONFIRM_HOST !== url.hostname ||
    env.HOMOLOGATION_CONFIRM_DATABASE !== database
  )
    throw new Error(
      'Confirm the exact host and database with HOMOLOGATION_CONFIRM_HOST and HOMOLOGATION_CONFIRM_DATABASE',
    );
  const password = env.HOMOLOGATION_PASSWORD;
  if (!password || password.length < 16 || password.length > 256 || password === env.DEMO_PASSWORD)
    throw new Error('HOMOLOGATION_PASSWORD must be a new 16–256 character password');
  return { url, password };
}
