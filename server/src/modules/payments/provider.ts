import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http.js';

export type ProviderName = 'razorpay' | 'mock';

export interface ProviderStatus {
  provider: ProviderName | null;
  available: boolean;
  testMode: boolean;
  message?: string;
}

export function providerStatus(): ProviderStatus {
  if (env.PAYMENT_PROVIDER === 'mock') {
    // env.ts refuses to boot with mock in production; this is a second guard.
    if (env.NODE_ENV === 'production') return { provider: null, available: false, testMode: false, message: 'Mock payments are disabled in production.' };
    return { provider: 'mock', available: true, testMode: true, message: 'Development payment simulator. No real payment is taken.' };
  }
  if (env.PAYMENT_PROVIDER === 'razorpay') {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return { provider: 'razorpay', available: false, testMode: false, message: 'Payments are not configured: set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' };
    }
    return { provider: 'razorpay', available: true, testMode: env.RAZORPAY_KEY_ID.startsWith('rzp_test_') };
  }
  return { provider: null, available: false, testMode: false, message: 'Online payments are not configured on this store yet.' };
}

const RZP = 'https://api.razorpay.com/v1';
const authHeader = () => 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');

export async function razorpayCreateOrder(amountPaise: number, receipt: string): Promise<{ id: string }> {
  const res = await fetch(`${RZP}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(502, 'Could not start payment with the provider. Please try again.', 'provider_error');
  return (await res.json()) as { id: string };
}

export async function razorpayRefund(paymentId: string, amountPaise: number) {
  const res = await fetch(`${RZP}/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(502, 'Refund request to the payment provider failed.', 'provider_error');
  return res.json();
}

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/** Razorpay Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** Razorpay webhook signature: HMAC_SHA256(raw_body, webhook_secret). */
export function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
