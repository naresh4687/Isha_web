import type { Page } from '@playwright/test';

export async function acceptCookies(page: Page, value: 'analytics' | 'essential' = 'essential') {
  await page.context().addCookies([{ name: 'consent', value, url: 'http://localhost:5174' }]);
}

let n = 0;
export async function register(page: Page) {
  const email = `e2e${Date.now()}${n++}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Name').fill('Asha Rao');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password').fill('Passw0rd!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/account');
  return email;
}

export async function fillAddress(page: Page) {
  await page.getByLabel('Full name').fill('Asha Rao');
  await page.getByLabel('Mobile number').fill('98765 43210');
  await page.getByLabel('PIN code').fill('560001');
  await page.getByLabel('Address', { exact: true }).fill('12 Lake View Road');
  await page.getByLabel('City').fill('Bengaluru');
  await page.getByLabel('State / UT').selectOption('Karnataka');
}
