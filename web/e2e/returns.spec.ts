import { expect, test } from '@playwright/test';
import { acceptCookies, fillAddress, register } from './helpers';

async function adminPage(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'consent', value: 'essential', url: 'http://localhost:5174' }]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@anvaya.local');
  await page.getByLabel('Password').fill('ChangeMe-Admin-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/account');
  return page;
}

test('customer returns one unit; admin approves; partial refund shown', async ({ page, browser }) => {
  await acceptCookies(page);
  await register(page);
  await page.goto('/products/the-millet-kitchen');
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart')).toBeVisible();
  await page.goto('/checkout');
  await fillAddress(page);
  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByRole('heading', { name: /order is confirmed/ })).toBeVisible();
  const orderUrl = page.url().split('?')[0];
  const orderId = orderUrl.split('/').pop()!;

  const admin = await adminPage(browser);
  for (const action of ['ship', 'deliver']) {
    const r = await admin.request.post(`/api/admin/orders/${orderId}/status`, { headers: { 'X-Requested-With': 'fetch' }, data: { action } });
    expect(r.ok()).toBeTruthy();
  }

  await page.goto(orderUrl);
  await expect(page.getByRole('heading', { name: 'Returns' })).toBeVisible();
  await page.getByLabel('Quantity of The Millet Kitchen to return').selectOption('1');
  await page.getByLabel('Reason').fill('The spine arrived cracked.');
  await page.getByRole('button', { name: 'Request return' }).click();
  await expect(page.getByText('Requested — awaiting review')).toBeVisible();

  await admin.goto('/admin/orders');
  const row = admin.getByRole('listitem').filter({ hasText: 'The spine arrived cracked.' });
  await expect(row).toBeVisible();
  admin.on('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Approve & refund' }).click();
  await expect(row).toBeHidden();

  await page.reload();
  await expect(page.getByText('Approved and refunded')).toBeVisible();
  await expect(page.getByText(/A partial refund of ₹599/)).toBeVisible();
  await expect(page.getByText('1 refunded (₹599)')).toBeVisible();
});
