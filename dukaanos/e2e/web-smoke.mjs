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
const step = async (name, fn) => {
  process.stdout.write(`▶ ${name} … `);
  const before = errors.length;
  try { await fn(); console.log('ok'); } catch (e) { console.log('FAIL'); await shot(`FAIL-${name.replace(/\W+/g, '_')}`); throw e; }
  finally { const fresh = errors.slice(before).filter((x) => !/favicon|React DevTools|ResizeObserver/.test(x)); if (fresh.length) console.log(`   ⚠ ${fresh.length} console error(s) during "${name}": ${fresh.map((x) => x.slice(0, 200)).join(' | ')}`); }
};
/** Click, falling back to a direct DOM click when another (web-only) tab scene intercepts pointer events. */
/** Text locator restricted to visible nodes (web keeps inactive tab scenes in the DOM). */
const txt = (text, opts) => page.getByText(text, opts).filter({ visible: true });
const tap = async (locator) => {
  try { await locator.click({ timeout: 4000 }); }
  catch (e) { if (!String(e).includes('intercepts pointer events')) throw e; process.stdout.write('[web z-order fallback] '); await locator.evaluate((el) => el.closest('[role=button],[tabindex],a,button')?.click() ?? el.click()); }
};

try {
  await step('load app', async () => { await page.goto(base, { waitUntil: 'networkidle' }); await txt('DukaanOS', { exact: false }).first().waitFor({ timeout: 60_000 }); await shot('01-login'); });
  await step('owner sign-up', async () => {
    await tap(txt('New shop? Create owner account'));
    await page.getByPlaceholder('owner@example.com').fill(email);
    await page.getByPlaceholder('••••••••').fill(password);
    await tap(txt('Create account', { exact: true }));
    await txt('Create your shop').first().waitFor({ timeout: 30_000 });
    await shot('02-create-shop');
  });
  await step('create shop', async () => {
    await page.getByPlaceholder('Sharma Kirana Store').fill('E2E Kirana');
    await page.getByPlaceholder('Sharma ji').fill('Owner');
    await tap(txt('Create shop', { exact: true }));
    await txt('Recorded sales').waitFor({ timeout: 30_000 });
    await shot('03-dashboard-empty');
  });
  await step('add product', async () => {
    await tap(txt('Stock', { exact: true }));
    await tap(txt('+ Product'));
    await page.getByPlaceholder('Basmati Rice').fill('Chawal');
    await tap(txt('kg · किलो'));
    await page.getByPlaceholder('0').first().fill('80');
    await tap(txt('Add product'));
    await txt('Chawal').first().waitFor({ timeout: 15_000 });
    await shot('04-product-list');
  });
  await step('record cash sale', async () => {
    await tap(txt('Sales', { exact: true }));
    await tap(txt('New sale').first());
    await tap(txt('Chawal').first());           // loose → qty picker
    await tap(txt('1 kg', { exact: true }));
    await tap(txt('Add to bill'));
    await tap(txt('Pay ▸').first());
    await tap(txt(/Confirm ₹80/));
    await txt('Sale recorded').waitFor({ timeout: 15_000 });
    await shot('05-sale-done');
  });
  await step('dashboard reflects sale', async () => {
    await txt('Home').first().click().catch(() => txt('Dashboard').first().click());
    await txt('Recorded sales (1 bills)').waitFor({ timeout: 30_000 });
    await txt('Verified').waitFor({ timeout: 30_000 });
    await shot('06-dashboard-sale');
  });
  await step('stock deducted', async () => {
    await tap(txt('Stock', { exact: true }));
    await txt('-1 kg').waitFor({ timeout: 15_000 });
    await shot('07-stock');
  });
  if (process.env.E2E_FULL === '1') {
    let shopCode = '';
    await step('add employee + PIN', async () => {
      await tap(txt('More', { exact: true }));
      await tap(txt('Employees').first());
      await tap(txt('+ Add employee'));
      await page.locator('input:visible').first().fill('Ramu');
      await tap(txt('Create employee'));
      await txt('Set login PIN').waitFor({ timeout: 20_000 });
      await page.getByPlaceholder('••••').fill('1234');
      await tap(txt('Set PIN', { exact: true }));
      await txt(/PIN set/).waitFor({ timeout: 20_000 });
      await shot('08-employee-pin');
    });
    await step('read shop code', async () => {
      await tap(txt('Back to employees'));
      await page.goBack();
      await tap(txt('Settings').first());
      const code = await page.locator('text=/^[A-Z0-9]{6}$/').first().textContent({ timeout: 20_000 });
      shopCode = (code ?? '').trim();
      if (!/^[A-Z0-9]{6}$/.test(shopCode)) throw new Error('shop code not found: ' + code);
      await shot('09-settings');
    });
    await step('sign out owner', async () => {
      await page.goBack();
      page.once('dialog', (d) => d.accept());
      await tap(txt('Sign out of this device'));
      // RN web Alert → window.confirm; some builds render a custom dialog
      await txt('Sign out', { exact: true }).click({ timeout: 5000 }).catch(() => undefined);
      await txt('Employee login with PIN').waitFor({ timeout: 30_000 });
    });
    await step('employee PIN login', async () => {
      await tap(txt('Employee login with PIN'));
      await page.getByPlaceholder('e.g. SHARMA').fill(shopCode);
      await tap(txt('Find shop'));
      await tap(txt('Ramu').first());
      for (const d of ['1', '2', '3', '4']) await tap(txt(d, { exact: true }).last());
      await txt('Shift not open').waitFor({ timeout: 40_000 });
      await shot('10-employee-home');
    });
    await step('open shift, sale, close shift', async () => {
      await tap(txt('Open shift', { exact: true }).first());
      await page.getByPlaceholder('0').first().fill('500');
      await tap(txt('Open shift', { exact: true }).last());
      await txt(/Your shift/).waitFor({ timeout: 20_000 });
      await tap(txt('New sale').first());
      await tap(txt('Chawal').first());
      await tap(txt('2 kg', { exact: true }));
      await tap(txt('Add to bill'));
      await tap(txt('Pay ▸').first());
      await tap(txt(/Confirm ₹160/));
      await txt('Sale recorded').waitFor({ timeout: 15_000 });
      await tap(txt('Home', { exact: true }));
      await tap(txt('Close shift').first());
      await txt('Expected cash in drawer').waitFor({ timeout: 20_000 });
      await txt('₹660').first().waitFor({ timeout: 10_000 }); // 500 + 160
      await page.getByPlaceholder('0').first().fill('650');            // short by 10
      await txt('Short').waitFor();
      page.once('dialog', (d) => d.accept());
      await tap(txt('Close shift', { exact: true }).last());
      await txt('Close anyway').click({ timeout: 5000 }).catch(() => undefined);
      await txt('-₹10').first().waitFor({ timeout: 30_000 });
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
