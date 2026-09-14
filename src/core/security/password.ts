import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { constantTimeHexEqual } from './crypto';

const PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const result = await scryptAsync(password, salt, PARAMS);
    return `scrypt$${bytesToHex(salt)}$${bytesToHex(result)}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, saltHex, hashHex] = encoded.split('$');
    if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
    try {
      const result = await scryptAsync(password, hexToBytes(saltHex), PARAMS);
      return constantTimeHexEqual(bytesToHex(result), hashHex);
    } catch {
      return false;
    }
  }
}
