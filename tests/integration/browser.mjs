import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

test('mobile Supabase checkout, persisted offline request, and real retry', { timeout: 120000 }, async () => {
  const base = process.env.TOVARIX_TEST_WEB;
  assert.ok(base, 'Start the configured production preview against local Supabase');
  const browser = await chromium.launch({ executablePath: process.env.TOVARIX_CHROMIUM || undefined, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole('combobox', { name: 'Language' }).selectOption('en');
    await page.getByRole('textbox', { name: 'Email' }).fill('cashier-' + Date.now() + '@example.com');
    await page.getByLabel('Password').fill('Disposable-Tovarix-2026!');
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Create business' }).click();
    await page.getByRole('textbox', { name: 'Business', exact: true }).fill('Integration test');
    await page.getByRole('textbox', { name: 'Location', exact: true }).fill('Main');
    await page.getByRole('button', { name: 'Create business', exact: true }).click();
    await page.getByRole('button', { name: 'Products', exact: true }).click();
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
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Change' }).fill('2');
    await page.getByRole('textbox', { name: 'Reason' }).fill('Initial stock');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/Stock 2/).waitFor();

    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
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
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: '+Tea', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Submit sale' }).click();
    await page.getByText('Sale awaiting confirmation', { exact: false }).waitFor();
    assert.equal(await page.getByText('Internal receipt', { exact: true }).count(), 0);
    await page.reload();
    await page.getByText('Sale awaiting confirmation', { exact: false }).waitFor();

    await context.setOffline(false);
    await page.getByRole('button', { name: 'Retry submission' }).click();
    await page.getByRole('heading', { name: 'Internal receipt' }).waitFor();
    await page.getByRole('button', { name: 'Inventory', exact: true }).click();
    await page.getByText(/Stock 1/).waitFor();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('tovarix.outbox.')).length), 0);
  } finally {
    await browser.close();
  }
});
