import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { expirePendingOrders } from './modules/orders/service.js';
import { providerStatus } from './modules/payments/provider.js';

await migrate();
const app = createApp();
app.listen(env.PORT, () => {
  const p = providerStatus();
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`Payments: ${p.provider ?? 'none'} - ${p.available ? (p.testMode ? 'TEST MODE' : 'LIVE') : 'unavailable'}${p.message ? ` (${p.message})` : ''}`);
});

// Release stock held by abandoned payment attempts.
setInterval(() => {
  expirePendingOrders().catch((err) => console.error('expirePendingOrders failed', err));
}, 5 * 60_000).unref();
