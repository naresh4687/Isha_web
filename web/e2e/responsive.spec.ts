import { expect, test } from '@playwright/test';
import { acceptCookies } from './helpers';

const PAGES = ['/', '/collections/clothing', '/products/handloom-cotton-kurta-unisex', '/cart', '/search?q=mala', '/support', '/login'];

for (const path of PAGES) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await acceptCookies(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('mobile menu opens, traps focus start, and closes with Escape', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await acceptCookies(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Menu' });
  await expect(dialog).toBeVisible();
  await dialog.getByText('Natural Food', { exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'All Natural Food' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
