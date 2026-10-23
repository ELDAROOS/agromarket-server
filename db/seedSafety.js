export function isLocalDatabase(env = process.env) {
  let host = env.PGHOST || '';
  if (env.DATABASE_URL) {
    try { host = new URL(env.DATABASE_URL).hostname; } catch { return false; }
  }
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
}
