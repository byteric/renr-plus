import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, hash] = encoded.split(':');
  if (algorithm !== 'scrypt' || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const key = await derive(password, salt);
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
