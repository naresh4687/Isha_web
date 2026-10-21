import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { acceptCookies } from './helpers';

const PAGES = ['/', '/collections/yoga-store', '/products/cork-yoga-block', '/cart', '/login', '/register', '/support'];

for (const path of PAGES) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious accessibility violations on ${path} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await acceptCookies(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
}

test('keyboard: skip link and category menu', async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), 'desktop navigation');
  await acceptCookies(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const toggle = page.getByRole('button', { name: 'Rudraksha subcategories' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
