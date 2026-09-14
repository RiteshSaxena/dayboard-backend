import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const testSecrets = {
  TURNSTILE_SECRET: 'test-secret',
  SMTP_HOST: 'smtp.example.test',
  SMTP_USERNAME: 'test',
  SMTP_PASSWORD: 'test',
};
Object.assign(process.env, testSecrets);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
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
