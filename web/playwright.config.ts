import { defineConfig, devices } from '@playwright/test';

const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgres://anvaya:anvaya_dev_password@localhost:5433/anvaya_e2e';

/**
 * End-to-end tests run against an isolated stack: a fresh anvaya_e2e database, an API on :4100
 * (mock payments, ML service deliberately unreachable so fallbacks are exercised) and Vite on :5174.
 * Requires the Postgres container: `docker compose up -d db`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive|a11y/ },
  ],
  webServer: [
    {
      command: `cd ../server && DATABASE_URL=${E2E_DB} npm run e2e:prepare && DATABASE_URL=${E2E_DB} PORT=4100 PAYMENT_PROVIDER=mock ML_SERVICE_URL=http://127.0.0.1:1 ML_SERVICE_TOKEN=x NODE_ENV=development npx tsx src/index.ts`,
      url: 'http://localhost:4100/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'API_URL=http://localhost:4100 npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
