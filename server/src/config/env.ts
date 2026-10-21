import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BRAND_NAME: z.string().default('Anvaya'),
  PAYMENT_PROVIDER: z.enum(['razorpay', 'mock', 'none']).default('none'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  ML_SERVICE_URL: z.string().default('http://localhost:8001'),
  ML_SERVICE_TOKEN: z.string().default(''),
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(395),
  LOW_STOCK_THRESHOLD: z.coerce.number().int().nonnegative().default(5),
  FREE_SHIPPING_THRESHOLD_PAISE: z.coerce.number().int().default(99900),
  SHIPPING_FEE_PAISE: z.coerce.number().int().default(7900),
  // Seller's registered state; decides CGST+SGST (same state) vs IGST (inter-state) in tax breakdowns.
  SELLER_STATE: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
  console.error('PAYMENT_PROVIDER=mock is not allowed in production.');
  process.exit(1);
}

if (
  env.PAYMENT_PROVIDER === 'razorpay' &&
  (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)
) {
  console.warn(
    'PAYMENT_PROVIDER=razorpay but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing; checkout will report payments as unavailable.',
  );
}
