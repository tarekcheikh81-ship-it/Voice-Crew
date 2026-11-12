const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
  await page.goto('http://localhost:8014/'); await page.waitForTimeout(3000);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#log .row')].map(r => r.textContent.replace(/\s+/g, ' ')));
  const sys = () => page.evaluate(() => [...document.querySelectorAll('#log .sysmsg')].map(r => r.textContent.replace(/\s+/g, ' ')));
  // 1. no access yet: the server must refuse to look, and the page must say so and wait
  await page.fill('#input', 'truck 88113 safety report today'); await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  let r = await rows(); console.log(JSON.stringify(r).slice(0, 400));
  ok(!r.some(t => /Ali Hassan|Speeding/.test(t)), 'nothing is read from Samsara before access is granted');
  ok((await sys()).some(t => /needs Samsara access/i.test(t)), 'the page shows that Samsara access is needed: ' + JSON.stringify(await sys()));
  ok(await page.evaluate(async () => (await window.crewApi.grants()).caps.find(c => c.id === 'samsara').granted === false), 'the server says Samsara is not granted');
  // 2. grant by voice/text: it proceeds with the same request on its own
  await page.fill('#input', 'yes, give the team Samsara access'); await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  r = await rows();
  ok(await page.evaluate(async () => (await window.crewApi.grants()).caps.find(c => c.id === 'samsara').granted === true), 'the server now says Samsara is granted');
  ok(r.some(t => /Truck 88113 had 2 safety events today/.test(t)), 'the blocked request went ahead by itself after the grant');
  ok(r.some(t => /Full details/.test(t) && /Speeding/.test(t) && /Harsh brake/.test(t) && /top speed 74 mph in a 65 mph zone/.test(t) && /Memphis, TN/.test(t)), 'the full list is on screen');
  // 3. the record kept by the server
  const act = await page.evaluate(async () => (await window.crewApi.activity(60)).entries || (await window.crewApi.activity(60)));
  const kinds = JSON.stringify(act);
  ok(/grant/.test(kinds) && /Samsara/.test(kinds), 'the server recorded the grant');
  ok(/worked/.test(kinds) && /88113/.test(kinds), 'the server recorded the work it did for truck 88113');
  ok(!/tok-river|tok-abbas/.test(kinds), 'no token appears in the record');
  await page.click('#reportBtn'); await page.waitForTimeout(1200);
  const rep = await page.evaluate(() => document.getElementById('rdList').textContent.replace(/\s+/g, ' '));
  ok(/88113/.test(rep) && /Samsara/.test(rep), 'the Report dialog lists what was done: ' + rep.slice(0, 200));
  await page.screenshot({ path: dir + 'vc/s-report.png' });
  await page.evaluate(() => document.getElementById('reportDlg').close());
  // 4. take it back by voice: lookups stop
  await page.fill('#input', 'revoke the Samsara access'); await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  ok(await page.evaluate(async () => (await window.crewApi.grants()).caps.find(c => c.id === 'samsara').granted === false), 'revoke by voice turns it off on the server');
  await page.fill('#input', 'truck 88113 safety report today'); await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  r = await rows(); const lastTruck = r.filter(t => /Truck 88113 had 2 safety events/.test(t)).length;
  ok(lastTruck === 1, 'no second lookup after it was taken back (' + lastTruck + ' answers with data)');
  await page.fill('#input', 'build the login screen'); await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  r = await rows(); ok(r.some(t => /Nothing from Samsara in that message/.test(t)), 'an ordinary request carries no Samsara block');
  // teach through the hosted page too
  await page.fill('#input', 'Teach Michael: always give me the worst event first.'); await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  ok((await page.textContent('#teachBtn')).trim() === 'Teach · 1', 'Teach works on the hosted page');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await page.screenshot({ path: dir + 'vc/s-desk.png' });
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
