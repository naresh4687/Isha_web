// Creates (or resets) the isolated end-to-end database and seeds the sample catalog.
// Usage: DATABASE_URL=postgres://.../anvaya_e2e npm run e2e:prepare
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL ?? '');
if (!url.pathname.endsWith('_e2e')) throw new Error('e2e:prepare only runs against a *_e2e database');
const dbName = url.pathname.slice(1);
const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (!exists.rowCount) await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

const { pool } = await import('../db/pool.js');
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
const { migrate } = await import('../db/migrate.js');
await migrate(false);
const { seedCatalog } = await import('../../seed/seed.js');
await seedCatalog();
await pool.end();
console.log(`e2e database ${dbName} ready`);
