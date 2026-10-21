import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, variantWithStock } from './helpers.js';
import { query } from '../src/db/pool.js';

function consented() {
  const agent = request.agent(app);
  return (body: unknown) => agent.post('/api/events').set('X-Requested-With', 'fetch').set('Cookie', 'consent=analytics').send(body as object);
}

describe('POST /api/events', () => {
  it('stores nothing without analytics consent', async () => {
    const res = await request(app).post('/api/events').set('X-Requested-With', 'fetch').send({ events: [{ type: 'page_view', metadata: { path: '/' } }] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 0, reason: 'no_consent' });
  });

  it('accepts valid batches, creates a session and sets the session cookie', async () => {
    const { product_id } = await variantWithStock(5);
    const send = consented();
    const res = await send({ context: { source: 'email', device: 'mobile' }, events: [{ type: 'page_view', metadata: { path: '/' } }, { type: 'product_view', productId: product_id }] });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(2);
    const sid = (res.headers['set-cookie'] as unknown as string[]).find((c: string) => c.startsWith('asid='))!.split(';')[0].split('=')[1];
    const sess = await query('SELECT source, device FROM analytics_sessions WHERE id = $1', [sid]);
    expect(sess[0]).toEqual({ source: 'email', device: 'mobile' });
    const evs = await query('SELECT event_type, product_id FROM events WHERE session_id = $1 ORDER BY id', [sid]);
    expect(evs.map((e) => e.event_type)).toEqual(['page_view', 'product_view']);
  });

  it.each([
    ['unknown event type', { events: [{ type: 'purchase', productId: '00000000-0000-4000-8000-000000000000' }] }],
    ['missing productId', { events: [{ type: 'add_to_cart' }] }],
    ['rec_click without placement', { events: [{ type: 'rec_click', productId: '00000000-0000-4000-8000-000000000000' }] }],
    ['bad uuid', { events: [{ type: 'product_view', productId: '123' }] }],
    ['unexpected metadata field', { events: [{ type: 'page_view', metadata: { email: 'x@y.z' } }] }],
    ['unexpected top-level field', { events: [{ type: 'page_view', userId: 'abc' }] }],
    ['empty batch', { events: [] }],
    ['oversized batch', { events: Array.from({ length: 26 }, () => ({ type: 'page_view' })) }],
    ['missing events', {}],
    ['quantity out of range', { events: [{ type: 'add_to_cart', productId: '00000000-0000-4000-8000-000000000000', quantity: 500 }] }],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await consented()(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects unknown product ids', async () => {
    const res = await consented()({ events: [{ type: 'product_view', productId: '00000000-0000-4000-8000-000000000000' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.details.unknown).toHaveLength(1);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app).post('/api/events').set('X-Requested-With', 'fetch').set('Cookie', 'consent=analytics').set('Content-Type', 'application/json').send('{"events": [');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_json');
  });
});
