// Retention: delete behavioural events and analytics sessions older than EVENT_RETENTION_DAYS.
// Orders keep their analytics_session_id reference as an opaque string after purge.
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const days = String(env.EVENT_RETENTION_DAYS);
const ev = await pool.query(`DELETE FROM events WHERE created_at < now() - ($1 || ' days')::interval`, [days]);
const ss = await pool.query(`DELETE FROM analytics_sessions WHERE last_seen_at < now() - ($1 || ' days')::interval`, [days]);
console.log(`purged ${ev.rowCount} events and ${ss.rowCount} sessions older than ${days} days`);
await pool.end();
