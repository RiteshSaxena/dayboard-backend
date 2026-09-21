import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const testSecrets = {
  TURNSTILE_SECRET: 'test-secret',
  SMTP_HOST: 'smtp.example.test',
  SMTP_USERNAME: 'test',
  SMTP_PASSWORD: 'test',
  FILE_URL_SECRET: 'test-file-secret',
  // uploads go through the Worker in tests, even when .dev.vars holds real R2 keys
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
};
Object.assign(process.env, testSecrets);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      // The FILES binding is remote in `wrangler dev`; tests always use local storage so they never
      // read or write the real bucket.
      remoteBindings: false,
      miniflare: {
        // The bucket binding is remote in `wrangler dev`; tests always use local storage so they
        // never touch the real bucket.
        r2Buckets: ['FILES'],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./drizzle'),
          ...testSecrets,
        },
      },
    })),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
