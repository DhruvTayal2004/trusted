/**
 * Browser end-to-end smoke test against a running Expo web dev server + local Supabase stack.
 *   node e2e/web-smoke.mjs http://localhost:8081
 * Drives the acceptance flow: owner sign-up → create shop → add product → record a cash sale →
 * dashboard shows the sale. Fails loudly on any console error or failed step. Screenshots in e2e/out/.
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // pre-installed globally in this environment
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8081';
const out = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const stamp = Date.now().toString(36);
const email = `owner-${stamp}@test.local`;
const password = 'Passw0rd!123';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // Pixel-ish
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const step = async (name, fn) => { process.stdout.write(`▶ ${name} … `); try { await fn(); console.log('ok'); } catch (e) { console.log('FAIL'); await shot(`FAIL-${name.replace(/\W+/g, '_')}`); throw e; } };

try {
  await step('load app', async () => { await page.goto(base, { waitUntil: 'networkidle' }); await page.getByText('DukaanOS', { exact: false }).first().waitFor({ timeout: 60_000 }); await shot('01-login'); });
  await step('owner sign-up', async () => {
    await page.getByText('New shop? Create owner account').click();
    await page.getByPlaceholder('owner@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await page.getByText('Create account', { exact: true }).click();
    await page.getByText('Create your shop').first().waitFor({ timeout: 30_000 });
    await shot('02-create-shop');
  });
  await step('create shop', async () => {
    await page.getByPlaceholder('Sharma Kirana Store').fill('E2E Kirana');
    await page.getByPlaceholder('Sharma ji').fill('Owner');
    await page.getByText('Create shop', { exact: true }).click();
    await page.getByText('Recorded sales').waitFor({ timeout: 30_000 });
    await shot('03-dashboard-empty');
  });
  await step('add product', async () => {
    await page.getByText('Stock', { exact: true }).click();
    await page.getByText('+ Product').click();
    await page.getByPlaceholder('Basmati Rice').fill('Chawal');
    await page.getByText('kg · किलो').click();
    await page.getByPlaceholder('0').first().fill('80');
    await page.getByText('Add product').click();
    await page.getByText('Chawal').first().waitFor({ timeout: 15_000 });
    await shot('04-product-list');
  });
  await step('record cash sale', async () => {
    await page.getByText('Sales', { exact: true }).click();
    await page.getByText('New sale').first().click();
    await page.getByText('Chawal').first().click();           // loose → qty picker
    await page.getByText('1 kg', { exact: true }).click();
    await page.getByText('Add to bill').click();
    await page.getByText('Pay ▸').first().click();
    await page.getByText(/Confirm ₹80/).click();
    await page.getByText('Sale recorded').waitFor({ timeout: 15_000 });
    await shot('05-sale-done');
  });
  await step('dashboard reflects sale', async () => {
    await page.getByText('Home').first().click().catch(() => page.getByText('Dashboard').first().click());
    await page.getByText('Recorded sales (1 bills)').waitFor({ timeout: 30_000 });
    await page.getByText('Verified').waitFor({ timeout: 30_000 });
    await shot('06-dashboard-sale');
  });
  await step('stock deducted', async () => {
    await page.getByText('Stock', { exact: true }).click();
    await page.getByText('-1 kg').waitFor({ timeout: 15_000 });
    await shot('07-stock');
  });
  if (process.env.E2E_FULL === '1') {
    let shopCode = '';
    await step('add employee + PIN', async () => {
      await page.getByText('More', { exact: true }).click();
      await page.getByText('Employees').first().click();
      await page.getByText('+ Add employee').click();
      await page.getByPlaceholder('').first().fill('Ramu').catch(() => undefined);
      const nameField = page.locator('input').first();
      await nameField.fill('Ramu');
      await page.getByText('Create employee').click();
      await page.getByText('Set login PIN').waitFor({ timeout: 20_000 });
      await page.getByPlaceholder('••••').fill('1234');
      await page.getByText('Set PIN', { exact: true }).click();
      await page.getByText(/PIN set/).waitFor({ timeout: 20_000 });
      await shot('08-employee-pin');
    });
    await step('read shop code', async () => {
      await page.getByText('Back to employees').click();
      await page.goBack();
      await page.getByText('Settings').first().click();
      const code = await page.locator('text=/^[A-Z0-9]{6}$/').first().textContent({ timeout: 20_000 });
      shopCode = (code ?? '').trim();
      if (!/^[A-Z0-9]{6}$/.test(shopCode)) throw new Error('shop code not found: ' + code);
      await shot('09-settings');
    });
    await step('sign out owner', async () => {
      await page.goBack();
      page.once('dialog', (d) => d.accept());
      await page.getByText('Sign out of this device').click();
      // RN web Alert → window.confirm; some builds render a custom dialog
      await page.getByText('Sign out', { exact: true }).click({ timeout: 5000 }).catch(() => undefined);
      await page.getByText('Employee login with PIN').waitFor({ timeout: 30_000 });
    });
    await step('employee PIN login', async () => {
      await page.getByText('Employee login with PIN').click();
      await page.getByPlaceholder('e.g. SHARMA').fill(shopCode);
      await page.getByText('Find shop').click();
      await page.getByText('Ramu').first().click();
      for (const d of ['1', '2', '3', '4']) await page.getByText(d, { exact: true }).last().click();
      await page.getByText('Shift not open').waitFor({ timeout: 40_000 });
      await shot('10-employee-home');
    });
    await step('open shift, sale, close shift', async () => {
      await page.getByText('Open shift', { exact: true }).first().click();
      await page.getByPlaceholder('0').first().fill('500');
      await page.getByText('Open shift', { exact: true }).last().click();
      await page.getByText(/Your shift/).waitFor({ timeout: 20_000 });
      await page.getByText('New sale').first().click();
      await page.getByText('Chawal').first().click();
      await page.getByText('2 kg', { exact: true }).click();
      await page.getByText('Add to bill').click();
      await page.getByText('Pay ▸').first().click();
      await page.getByText(/Confirm ₹160/).click();
      await page.getByText('Sale recorded').waitFor({ timeout: 15_000 });
      await page.getByText('Home', { exact: true }).click();
      await page.getByText('Close shift').first().click();
      await page.getByText('Expected cash in drawer').waitFor({ timeout: 20_000 });
      await page.getByText('₹660').first().waitFor({ timeout: 10_000 }); // 500 + 160
      await page.getByPlaceholder('0').first().fill('650');            // short by 10
      await page.getByText('Short').waitFor();
      page.once('dialog', (d) => d.accept());
      await page.getByText('Close shift', { exact: true }).last().click();
      await page.getByText('Close anyway').click({ timeout: 5000 }).catch(() => undefined);
      await page.getByText('-₹10').first().waitFor({ timeout: 30_000 });
      await shot('11-shift-closed-short');
    });
  }
  const real = errors.filter((e) => !/favicon|Download the React DevTools|ResizeObserver/.test(e));
  if (real.length) { console.log('\nConsole errors:'); real.forEach((e) => console.log(' -', e.slice(0, 300))); process.exitCode = 1; }
  else console.log('\nALL E2E STEPS PASSED, no console errors');
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  if (errors.length) { console.log('Console errors:'); errors.forEach((x) => console.log(' -', x.slice(0, 300))); }
  process.exitCode = 1;
} finally {
  await browser.close();
}
