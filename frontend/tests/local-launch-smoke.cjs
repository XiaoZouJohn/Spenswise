// Read-only smoke check for the compiled local launcher, not a Playwright test case.
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    const start = Date.now();
    await page.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.getByRole('button', { name: '登录', exact: true }).last().waitFor({ timeout: 10000 });
    console.log('Compiled app login rendered in', Date.now() - start, 'ms');
    await page.screenshot({ path: '../docs/superpowers/agent-login.png' });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
