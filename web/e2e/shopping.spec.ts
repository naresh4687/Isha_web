import { expect, test } from '@playwright/test';
import { acceptCookies, fillAddress, register } from './helpers';

test.beforeEach(async ({ page }) => acceptCookies(page));

test('browse, filter, search and view a product', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Considered goods');
  await page.getByRole('link', { name: 'Yoga Store', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Yoga Store' })).toBeVisible();
  await page.getByRole('button', { name: 'Mats' }).click();
  await expect(page).toHaveURL(/subcategory=Mats/);
  await expect(page.getByRole('article')).toHaveCount(2);

  await page.getByRole('searchbox').or(page.getByLabel('Search products')).first().fill('coper');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('coper');
  await expect(page.getByRole('article').first()).toContainText(/Copper/);

  await page.getByRole('article').first().getByRole('link').last().click();
  await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible();
  await expect(page.getByText('Inclusive of all taxes')).toBeVisible();
});

test('guest cart persists, then sign-up, checkout with simulated payment and order history', async ({ page }) => {
  await page.goto('/products/cork-yoga-block');
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart')).toBeVisible();
  await expect(page.getByRole('link', { name: /Cart, 2 items/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: /Cart, 2 items/ })).toBeVisible();

  await register(page);
  await page.goto('/cart');
  await expect(page.getByRole('list', { name: 'Cart items' }).getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Discount code').fill('WELCOME10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('WELCOME10 applied')).toBeVisible();
  await page.getByRole('button', { name: 'Checkout' }).click();

  await expect(page.getByText('Test mode.')).toBeVisible();
  await page.getByRole('button', { name: /^Pay/ }).click();
  // Client-side validation blocks an empty form.
  await expect(page.getByText('Enter a valid 6-digit PIN code')).toBeVisible();
  await fillAddress(page);
  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();

  await expect(page.getByRole('heading', { name: /order is confirmed/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Cart, 0 items/ })).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Order history' })).toBeVisible();
  await expect(page.getByText('Confirmed')).toBeVisible();

  // Cancel before shipment: refunded in full.
  await page.getByRole('link', { name: /#\d+/ }).first().click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelled' })).toBeVisible();
  await expect(page.getByText(/refund of/)).toBeVisible();
});

test('failed payment keeps the cart and explains nothing was charged', async ({ page }) => {
  await register(page);
  await page.goto('/products/raw-forest-honey');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart')).toBeVisible();
  await page.goto('/checkout');
  await fillAddress(page);
  await page.getByRole('button', { name: /^Pay/ }).click();
  await page.getByRole('button', { name: 'Simulate failed payment' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'nothing was charged' })).toBeVisible();
  await page.goto('/cart');
  await expect(page.getByRole('list', { name: 'Cart items' }).getByRole('listitem')).toHaveCount(1);
});

test('empty and error states', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await page.goto('/search?q=zzzzqqq');
  await expect(page.getByRole('heading', { name: 'Nothing matches yet' })).toBeVisible();
  await page.goto('/products/no-such-product');
  await expect(page.getByRole('heading', { name: "This product isn't available" })).toBeVisible();

  await page.route('**/api/products?*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }) }));
  await page.goto('/shop');
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('admin area is protected', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)admin/);
  await register(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible();
  const res = await page.request.get('/api/admin/analytics/overview');
  expect(res.status()).toBe(403);
});

test('admin sees the analytics dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@anvaya.local');
  await page.getByLabel('Password').fill('ChangeMe-Admin-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/account');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Business analytics' })).toBeVisible();
  await expect(page.getByText('Net sales', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '90 days' }).click();
  await expect(page).toHaveURL(/from=/);
  // ML service is intentionally offline in e2e: the BI page reports it instead of failing silently.
  await page.goto('/admin/insights');
  await expect(page.getByText(/ML service unavailable/).first()).toBeVisible();
});
