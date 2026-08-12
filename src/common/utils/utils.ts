import { randomBytes } from 'crypto';

export function generateRoomCode(length = 6): string {
  return randomBytes(length)
    .toString('base64url')
    .replace(/[-_]/g, '')
    .slice(0, length)
    .toUpperCase();
}
