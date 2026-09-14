import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { timingSafeEqual } from 'node:crypto';

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';

export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte & 63]).join('');
}

export function createToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  try {
    return timingSafeEqual(hexToBytes(left), hexToBytes(right));
  } catch {
    return false;
  }
}
