import './setupEnv.js';

/** Fresh schema + sample catalog for every test run (never touches the dev database). */
export default async function setup() {
  if (!process.env.DATABASE_URL!.includes('_test')) throw new Error('Refusing to run tests against a non-test database');
  const { pool } = await import('../src/db/pool.js');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { migrate } = await import('../src/db/migrate.js');
  await migrate(false);
  const { seedCatalog } = await import('../seed/seed.js');
  await seedCatalog();
  await pool.end();
}
