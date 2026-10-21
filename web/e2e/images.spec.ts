import { expect, test, type Page } from '@playwright/test';
import { acceptCookies } from './helpers';

test.beforeEach(async ({ page }) => acceptCookies(page));

const CATEGORIES = ['rudraksha', 'consecrated-products', 'yoga-store', 'natural-food', 'health-and-immunity', 'clothing', 'body-care', 'home-decor', 'books'];

/** Records failed image requests (HTTP errors or network failures) for the whole test. */
function watchImages(page: Page) {
  const failed: string[] = [];
  page.on('response', (r) => { if (r.request().resourceType() === 'image' && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => { if (r.resourceType() === 'image' && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) failed.push(`${r.failure()?.errorText} ${r.url()}`); });
  return failed;
}

/** Scrolls so lazy images load, then asserts every <img> decoded and none fell back. */
async function expectImagesRendered(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc || i.src)), { timeout: 15_000 }).toEqual([]);
  expect(await page.evaluate(() => [...document.images].filter((i) => i.dataset.fallback).map((i) => i.src))).toEqual([]);
  expect(await page.evaluate(() => [...document.images].filter((i) => !i.hasAttribute('alt')).length)).toBe(0);
}

test('every category page shows its product images without failures', async ({ page }) => {
  const failed = watchImages(page);
  for (const c of CATEGORIES) {
    await page.goto(`/collections/${c}`);
    await expect(page.getByRole('article').first()).toBeVisible();
    await expectImagesRendered(page);
  }
  expect(failed).toEqual([]);
});

test('home, search, product detail (photo and illustration), cart and wishlist use the same image', async ({ page }) => {
  const failed = watchImages(page);
  await page.goto('/');
  await expectImagesRendered(page);

  await page.goto('/search?q=copper');
  await expect(page.getByRole('article').first()).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: 'Copper Water Bottle' });
  const cardSrc = await card.locator('img').getAttribute('src');
  expect(cardSrc).toMatch(/^\/assets\/products\/copper-water-bottle-1-l\/0-[0-9a-f]{10}-800\.webp$/);
  await expectImagesRendered(page);

  await page.goto('/products/copper-water-bottle-1-l');
  const main = page.getByRole('tabpanel').locator('img');
  await expect(main).toHaveAttribute('src', cardSrc!);
  await expect(main).toHaveAttribute('alt', /copper water bottle/i);
  await expect(page.getByText(/Representative photo:/)).toBeVisible();
  await expect(page.getByRole('link', { name: /CC BY/ })).toHaveAttribute('href', /creativecommons\.org/);
  await expectImagesRendered(page);

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/cart');
  await expect(page.getByRole('list', { name: 'Cart items' }).locator('img').first()).toHaveAttribute('src', cardSrc!);
  await expectImagesRendered(page);

  await page.goto('/products/the-millet-kitchen');
  await expect(page.getByRole('tabpanel').locator('img')).toHaveAttribute('src', '/media/products/the-millet-kitchen/0.svg');
  await expect(page.getByText('Illustration — demo product, no photograph available.')).toBeVisible();
  await expectImagesRendered(page);
  expect(failed).toEqual([]);
});

test('gallery thumbnails switch the main image and are keyboard reachable', async ({ page }) => {
  await page.goto('/products/hand-cast-brass-oil-lamp');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  const first = await page.getByRole('tabpanel').locator('img').getAttribute('src');
  await tabs.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').locator('img')).not.toHaveAttribute('src', first!);
});

test('a missing photo falls back once, never shows a broken image and does not loop', async ({ page }) => {
  let hits = 0;
  await page.route('**/assets/products/cork-yoga-block/**', (r) => { hits++; return r.fulfill({ status: 404, body: '' }); });
  await page.goto('/products/cork-yoga-block');
  const main = page.getByRole('tabpanel').locator('img');
  await expect(main).toHaveAttribute('src', '/media/products/cork-yoga-block/0.svg');
  await expect.poll(() => main.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.waitForTimeout(500);
  const settled = hits;
  await page.waitForTimeout(800);
  expect(hits).toBe(settled); // no retry loop
});

test('image credits page lists attributions and admin shows product thumbnails', async ({ page }) => {
  const failed = watchImages(page);
  await page.goto('/image-credits');
  await expect(page.getByRole('heading', { level: 1, name: 'Image credits' })).toBeVisible();
  await expect(page.locator('main li').first()).toContainText(/CC|Public domain/);
  expect(await page.locator('main li').count()).toBeGreaterThan(80);

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@anvaya.local');
  await page.getByLabel('Password').fill('ChangeMe-Admin-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto('/admin/products');
  await expect(page.getByRole('table', { name: 'Products' }).locator('img').first()).toBeVisible();
  await expectImagesRendered(page);
  await page.getByRole('link', { name: 'Copper Water Bottle, 1 L' }).click();
  await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible();
  await expect(page.getByText(/Primary · CC BY/)).toBeVisible();
  expect(failed).toEqual([]);
});
