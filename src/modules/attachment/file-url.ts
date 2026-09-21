import { bytesToHex } from '@noble/hashes/utils.js';
import { constantTimeHexEqual } from '../../core/security/crypto';
import type { RuntimeContext } from '../../core/runtime/runtime-context';

/**
 * Files are served through signed, short-lived links instead of the bearer token: `<img>` and
 * `<video>` cannot send an Authorization header.
 */
const TTL_SECONDS = 900;

export type Disposition = 'inline' | 'attachment';

const encoder = new TextEncoder();

async function sign(
  secret: string,
  id: string,
  expiresAt: number,
  disposition: Disposition,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${id}.${expiresAt}.${disposition}`),
  );
  return bytesToHex(new Uint8Array(mac));
}

/** Where clients reach this API. `wrangler dev` reports request URLs as the deployed route. */
export function apiOrigin(runtime: RuntimeContext): string {
  return runtime.env.API_URL || new URL(runtime.request.url).origin;
}

export async function signFileUrl(
  runtime: RuntimeContext,
  id: string,
  disposition: Disposition,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const signature = await sign(runtime.env.FILE_URL_SECRET, id, expiresAt, disposition);
  const url = new URL(`/files/${id}`, apiOrigin(runtime));
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('d', disposition);
  url.searchParams.set('sig', signature);
  return url.toString();
}

/** Returns the disposition the link was signed for, or null when it is invalid or expired. */
export async function verifyFileUrl(
  env: Env,
  id: string,
  params: URLSearchParams,
): Promise<Disposition | null> {
  const expiresAt = Number(params.get('exp'));
  const disposition = params.get('d');
  const signature = params.get('sig');
  if (!Number.isSafeInteger(expiresAt) || !signature) return null;
  if (disposition !== 'inline' && disposition !== 'attachment') return null;
  if (expiresAt * 1000 <= Date.now()) return null;
  const expected = await sign(env.FILE_URL_SECRET, id, expiresAt, disposition);
  return constantTimeHexEqual(expected, signature) ? disposition : null;
}
