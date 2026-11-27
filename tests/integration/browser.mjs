import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

test('mobile Supabase checkout, persisted offline request, and real retry', { timeout: 120000 }, async () => {
  const base = process.env.TOVARIX_TEST_WEB;
  assert.ok(base, 'Start the configured production preview against local Supabase');
  const browser = await chromium.launch({ executablePath: process.env.TOVARIX_CHROMIUM || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(7500);
    await page.goto(base);
    assert.equal(await page.locator('html').getAttribute('lang'), 'uz');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('ru');
    await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('en');
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Synthetic');
    await page.getByRole('textbox', { name: 'Last name', exact: true }).fill('Cashier');
    await page.getByRole('textbox', { name: 'Contact phone (unverified)', exact: true }).fill('+998901234567');
    await page.getByLabel('Repeat password').fill('Disposable-Tovarix-2026!');
    await page.getByRole('checkbox', { name: 'I accept the pilot terms' }).check();
    await page.getByRole('textbox', { name: 'Email' }).fill('cashier-' + Date.now() + '@example.com');
    await page.getByLabel('Password', { exact:true }).fill('Disposable-Tovarix-2026!');
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Create business' }).click();
    await page.getByRole('textbox', { name: 'Business', exact: true }).fill('Integration test');
    await page.getByRole('textbox', { name: 'Location', exact: true }).fill('Main');
    await page.getByRole('button', { name: 'Create business', exact: true }).click();
    const menuTab = async name => {
      await page.locator('.bottom-navigation').getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name, exact: true }).click();
    };
    const screenshot = async name => {
      const directory = process.env.TOVARIX_SCREENSHOTS;
      if (!directory) return;
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
    };
    await menuTab('Customers');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Synthetic Buyer');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Synthetic Buyer', { exact: true }).waitFor();
    await menuTab('Customer debts');
    await page.getByRole('button', { name: 'Add debt' }).click();
    const opening = page.getByRole('dialog', { name: 'Add debt' });
    await opening.getByRole('combobox').selectOption({ label: 'Synthetic Buyer' });
    await opening.getByLabel('Due date').fill('2020-01-01');
    await opening.getByLabel('Amount').fill('1000');
    await opening.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: /Synthetic Buyer/ }).waitFor();
    await screenshot('customer-debts');
    await page.getByRole('button', { name: /Synthetic Buyer/ }).click();
    const debt = page.getByRole('dialog', { name: 'Synthetic Buyer' });
    await debt.getByLabel('Amount').fill('400');
    await debt.getByRole('button', { name: 'Record repayment' }).click();
    await page.getByRole('button', { name: /Synthetic Buyer.*600/ }).waitFor();
    await menuTab('Settings');
    const subscriptions = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Subscription requests' }) });
    await subscriptions.getByRole('button', { name: 'Submit request' }).click();
    await subscriptions.getByText(/UZS · Pending/).waitFor();
    assert.equal(await subscriptions.getByRole('link', { name: 'Contact us on Telegram' }).getAttribute('href'), 'https://t.me/uzPixelForge');
    await screenshot('subscription-requests');
    await page.locator('.bottom-navigation').getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Products', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Tea');
    await page.getByRole('button', { name: 'Generate code' }).click();
    await page.getByRole('spinbutton', { name: 'Price', exact: true }).fill('5000');
    await page.getByRole('spinbutton', { name: 'Cost', exact: true }).fill('3000');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Tea', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Label', exact: true }).click();
    const barcodeImage = page.locator('.label-print img');
    await barcodeImage.waitFor();
    assert.ok(await barcodeImage.evaluate(image => image.naturalWidth > 0));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'tovarix-catalog.xlsx');
    await page.locator('.bottom-navigation').getByRole('button', { name: 'Inventory', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Change' }).fill('2');
    await page.getByRole('textbox', { name: 'Reason' }).fill('Initial stock');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/Stock 2/).waitFor();

    await page.locator('.bottom-navigation').getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Cash in drawer' }).fill('0');
    await page.getByRole('button', { name: 'Open shift', exact: true }).click();
    await page.getByRole('button', { name: 'Close shift', exact: true }).waitFor();
    await page.getByRole('button', { name: '+Tea', exact: true }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    });
    await page.reload();
    await page.locator('.bottom-navigation').getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: '+Tea', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Submit sale' }).click();
    await page.getByText(/Sale awaiting confirmation.*1/).waitFor();
    for (const count of [2, 3]) {
      await page.getByRole('button', { name: '+Tea', exact: true }).click();
      await page.getByRole('button', { name: 'Submit sale' }).click();
      await page.getByText(new RegExp('Sale awaiting confirmation.*' + count)).waitFor();
    }
    assert.equal(await page.getByText('Internal receipt', { exact: true }).count(), 0);
    await page.reload();
    await page.getByText('Sale awaiting confirmation', { exact: false }).waitFor();

    await context.setOffline(false);

    await page.getByRole('heading', { name: 'Internal receipt' }).waitFor();
    await page.locator('.bottom-navigation').getByRole('button', { name: 'Inventory', exact: true }).click();
    await page.getByText(/Stock 0/).waitFor();
    await page.getByText('Synchronization history', { exact: true }).click();
    assert.equal(await page.getByText('Confirmed', { exact: true }).count(), 2);
    await page.getByText('Needs review', { exact: true }).waitFor();
    await page.getByText('insufficient stock', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('tovarix.outbox.')).length), 0);
  } finally {
    await browser.close();
  }
});
