import { AwsClient } from 'aws4fetch';

const UPLOAD_TTL_SECONDS = 900;

/**
 * True when R2 S3 credentials are configured. Without them (local development) uploads go through
 * the Worker instead, which keeps `wrangler dev` working with the local R2 emulation.
 */
export function canPresign(env: Env): boolean {
  return Boolean(
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_ACCOUNT_ID &&
    !env.R2_ACCOUNT_ID.startsWith('REPLACE_WITH'),
  );
}

/** A short-lived URL the browser can PUT the file to, bypassing the Worker's request size limit. */
export async function presignUpload(env: Env, key: string, contentType: string): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`,
  );
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_TTL_SECONDS));
  const signed = await client.sign(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    aws: { signQuery: true },
  });
  return signed.url;
}
