const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  let polls = 0; page.on('request', r => { if (/api\/progress/.test(r.url())) polls++; });
  await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
  await page.goto('http://localhost:8013/'); await page.waitForTimeout(3000);
  const ws = () => page.evaluate(() => [...document.querySelectorAll('#work .wk')].map(c => c.dataset.id + ' ' + c.dataset.state + ' | ' + c.querySelector('.wk-st').textContent + ' | ' + c.querySelector('.wk-prev').textContent));
  console.log('0 polls before any request', polls);
  await page.fill('#input', 'Plan the first version of the app'); await page.keyboard.press('Enter');
  for (const t of [2500, 3000, 3500, 4000]) { await page.waitForTimeout(t); console.log('state', JSON.stringify(await ws()), 'polls', polls); }
  await page.screenshot({ path: dir + 'vc/x-desk.png' });
  await page.waitForTimeout(16000);
  const p0 = polls; await page.waitForTimeout(3000);
  console.log('end', JSON.stringify(await ws()), 'polling stopped', polls === p0);
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();
