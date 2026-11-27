import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium, firefox } from 'playwright';

test('HTML opens offline from file with no adjacent assets', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tovarix-single-'));
  const file = join(directory, 'TOVARIX.html');
  await copyFile('dist-single/TOVARIX.html', file);
  const useChromium = Boolean(process.env.TOVARIX_CHROMIUM);
  const browser = useChromium
    ? await chromium.launch({ executablePath: process.env.TOVARIX_CHROMIUM, args: ['--no-sandbox'] })
    : await firefox.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: useChromium, hasTouch: true, offline: true });
    const page = await context.newPage();
    const problems = [];
    const requests = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error') problems.push(entry.text()); });
    page.on('request', request => requests.push(request.url()));
    await page.goto(pathToFileURL(file).href);
    await page.getByRole('heading', { name: 'Savdo ko‘rsatkichlari' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'uz');

    const shots = process.env.TOVARIX_SCREENSHOTS;
    if (shots) await mkdir(shots, { recursive: true });
    const capture = async name => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (shots) await page.screenshot({ path: join(shots, name + '.png'), animations: 'disabled' });
    };
    const nav = page.locator('.bottom-navigation');
    await capture('dashboard');
    await nav.getByRole('button', { name: 'Kassa', exact: true }).click();
    await page.getByRole('button', { name: '+Sut, 1 l', exact: true }).click();
    await page.getByRole('button', { name: 'Naqd', exact: true }).waitFor();
    await capture('checkout');
    await page.getByRole('button', { name: 'Mahalliy demo savdosini saqlash' }).click();
    await page.getByText('Demo savdosi saqlandi').waitFor();
    await nav.getByRole('button', { name: 'Ombor', exact: true }).click();
    await page.getByText('Qoldiq · 41').waitFor();
    await capture('inventory');
    await nav.getByRole('button', { name: 'Menyu', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Menyu' });
    await menu.waitFor();
    await capture('menu');
    await menu.getByRole('button', { name: 'Xodimlar' }).click();
    await page.getByRole('heading', { name: 'Xodimlar ro‘yxati' }).waitFor();
    await capture('employees');
    const language = page.getByRole('combobox', { name: 'Language' });
    await language.selectOption('ru');
    await page.getByRole('heading', { name: 'Список сотрудников' }).waitFor();
    await page.getByRole('button', { name: 'Тема' }).click();
    await page.locator('main.dark').waitFor();
    await language.selectOption('en');
    await page.getByRole('heading', { name: 'Employee directory' }).waitFor();
    await page.reload();
    await nav.getByRole('button', { name: 'Inventory', exact: true }).click();
    await page.getByText('Stock · 41').waitFor();
    for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Dark inventory overflow at ${width}px`);
    }
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.locator('main.light').waitFor();
    for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Light inventory overflow at ${width}px`);
    }
    assert.deepEqual(problems, []);
    assert.ok(requests.every(url => url === pathToFileURL(file).href), requests.join(', '));
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
