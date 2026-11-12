// Teach feature + Michael answering from live data
const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
const src = fs.readFileSync(dir + 'voice-crew.html', 'utf8');
fs.writeFileSync(dir + 'vc/test-page.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + src.replace(/<!doctype html>[\s\S]*?<body>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '') + '</body></html>');
const stub = () => `
window.__calls=[];
(function(){
  var ownerOf=function(p){var m=/The owner (?:just said|asked): ([^\\n]*)/.exec(p);return m?m[1]:'';};
  var f=async function(){return {}};
  f.json=function(prompt,opts){
    window.__calls.push(prompt);var owner=ownerOf(prompt);var full;
    if(/"intro"/.test(prompt)){
      if(/truck/.test(owner)) full={intro:'Truck 88113 had three events, two harsh brakes and one speeding.',details:'1. Nov 11 08:10 Harsh brake\\n2. Nov 11 14:32 Speeding\\n3. Nov 12 09:05 Harsh brake',picks:[],noted:[],answered:[]};
      else if(/Teach Mia|Michael, from now on|teach the team/i.test(owner)) full={intro:'Understood, I will follow that.',picks:[],noted:[],answered:[]};
      else full={intro:'Bringing in Mia and Leo.',picks:[{role:'Architect',ask:'schema',covering:null},{role:'Frontend',ask:'screen',covering:null}],noted:[],answered:[]};
    }else if(/"says"/.test(prompt)){
      var m=/You are (\\w+),/.exec(prompt),nm=m?m[1]:'Someone';
      full={says:nm+' here. Noted, I will do it that way.',details:null,code:null,handoff:null,noted:[],answered:[]};
    }else full={wrap:'All set.'};
    return Promise.resolve(full);
  };
  window.claude={use:async function(n){if(n==='sample')return f;return null;}};
})();`;
const bulk = (page, t) => page.evaluate((x) => { const i = document.getElementById('input'); i.focus(); i.value = x; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: x, bubbles: true })); }, t);
const send = async (page, t) => { await page.fill('#input', t); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); };
const block = (p) => { const m = /What the owner has taught[^\n]*\n((?:- [^\n]*\n|The owner has only just[^\n]*\n)+)/.exec(p || ''); return m ? m[0] : ''; };
const lessons = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('crew-lessons') || '[]').map(l => l.to + '|' + l.text); } catch (e) { return ['ERR']; } });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
  await page.addInitScript(stub());
  await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2200);

  // ---- 1. what counts as teaching (and what does not) ----
  const no = ['Teach me how to cook', 'What should I teach my kids about money', 'Plan the first version of our voice chat app', 'Next week we launch the app', 'I will teach Jimmy tomorrow', 'Teach Jimmy'];
  for (const t of no) { await send(page, t); }
  ok(JSON.stringify(await lessons(page)) === '[]', 'ordinary messages save nothing: ' + JSON.stringify(await lessons(page)));
  await send(page, 'Teach Jimmy: when I ask for a truck safety report, start with the worst event.');
  await send(page, 'teach the team to always answer in two sentences.');
  await send(page, 'Michael, from now on give me the numbers first.');
  await send(page, 'From now on, keep answers under 30 words.');
  await send(page, 'next time you write up a truck report, list the driver');
  const L = await lessons(page);
  console.log(JSON.stringify(L));
  ok(L.length === 5, 'five lessons saved (' + L.length + ')');
  ok(L[0] === 'Backend|When I ask for a truck safety report, start with the worst event.', 'Jimmy lesson cleaned: ' + L[0]);
  ok(L[1] === 'all|Always answer in two sentences.', 'team lesson: ' + L[1]);
  ok(L[2].startsWith('lead|From now on give me the numbers first'), 'Michael lesson: ' + L[2]);
  ok(L[3].startsWith('all|From now on, keep answers under 30 words'), 'plain from-now-on is for everyone: ' + L[3]);
  ok(L[4].startsWith('all|Next time you write up a truck report'), 'next time: ' + L[4]);
  const btn = await page.textContent('#teachBtn');
  ok(btn.trim() === 'Teach · 5', 'button shows the count: ' + btn);

  // ---- 2. lessons reach the right teammate ----
  await page.evaluate(() => { window.__calls.length = 0; });
  await send(page, 'Teach Mia: always name the database before anything else.');
  let calls = await page.evaluate(() => window.__calls.slice());
  const miaCall = calls.find(c => /You are Mia,/.test(c));
  ok(!!miaCall && /always name the database/i.test(miaCall) && /only just taught you/.test(miaCall), 'Mia hears the lesson and confirms it');
  ok(/answer in two sentences/i.test(block(miaCall)) && !/worst event/i.test(block(miaCall)) && /always name the database/i.test(block(miaCall)), 'Mia gets the team lesson and her own, not Jimmy\'s: ' + block(miaCall).replace(/\n/g, ' / ').slice(0, 300));
  await page.evaluate(() => { window.__calls.length = 0; });
  await send(page, 'build the login screen');
  await page.waitForTimeout(800);
  calls = await page.evaluate(() => window.__calls.slice());
  const lead = calls.find(c => /"intro"/.test(c)), mia = calls.find(c => /You are Mia,/.test(c)), leo = calls.find(c => /You are Leo,/.test(c));
  ok(!!lead && /\[Backend\]|\[Jimmy|\[Everyone\]/.test(lead) && /\[Mia\] Always name the database/.test(lead) , 'Michael sees every lesson with who it is for');
  ok(!!lead && !/only just taught/.test(lead), 'no "just taught" nag on later requests');
  ok(!!mia && /always name the database/i.test(mia) && !/only just taught/.test(mia), 'Mia keeps her lesson');
  ok(/answer in two sentences/i.test(block(leo)) && !/always name the database/i.test(block(leo)) && !/worst event/i.test(block(leo)) && !/numbers first/i.test(block(leo)), 'Leo gets only the team lessons: ' + block(leo).replace(/\n/g, ' / ').slice(0, 300));

  // ---- 3. Michael answers from live data, details on screen ----
  await page.evaluate(() => { window.__calls.length = 0; });
  await send(page, 'truck 88113 safety report November 11 to 12');
  const rowsTxt = await page.evaluate(() => [...document.querySelectorAll('#log .row')].map(r => r.textContent.replace(/\s+/g, ' ')).slice(-2));
  ok(rowsTxt.some(t => /three events/.test(t) && /Harsh brake/.test(t)), 'Michael\'s answer carries the on-screen list: ' + rowsTxt.join(' || ').slice(0, 220));
  calls = await page.evaluate(() => window.__calls.slice());
  const leadT = calls.find(c => /"intro"/.test(c));
  ok(/Live Samsara data/.test(leadT) && /"details": string\|null/.test(leadT), 'lead prompt explains the live data block and details field');
  ok(/cannot see Samsara or any other account/.test(leadT), 'honesty rule is in the prompt');

  // ---- 4. the Teach panel ----
  await page.click('#teachBtn'); await page.waitForTimeout(300);
  const dlg = await page.evaluate(() => ({ open: document.getElementById('teachDlg').open, opts: [...document.querySelectorAll('#tdWho option')].map(o => o.textContent), rows: document.querySelectorAll('#tdList .lrow').length, save: document.getElementById('tdSave').disabled }));
  ok(dlg.open && dlg.opts.length === 10 && dlg.opts[0] === 'Everyone', 'panel opens with 10 choices: ' + dlg.opts.join(' / '));
  ok(dlg.rows === 6 && dlg.save === true, 'six saved lessons are listed, Save disabled while empty');
  await page.selectOption('#tdWho', 'Sheets');
  await page.fill('#tdText', 'Keep every sheet to one tab and freeze the header row.');
  ok(await page.evaluate(() => !document.getElementById('tdSave').disabled), 'Save enables when there is text');
  await page.click('#tdSave'); await page.waitForTimeout(200);
  const after = await lessons(page);
  ok(after.length === 7 && after[6].startsWith('Sheets|Keep every sheet'), 'saved for Martina: ' + after[6]);
  await page.screenshot({ path: dir + 'vc/teach-desk.png' });
  await page.click('#tdList .lrow:first-child .n-del'); await page.waitForTimeout(150);
  ok((await lessons(page)).length === 6, 'delete removes one');
  await page.click('#tdClear'); ok((await lessons(page)).length === 6, 'clear needs a second tap');
  await page.click('#tdClear'); await page.waitForTimeout(150);
  ok((await lessons(page)).length === 0, 'second tap clears all');
  await page.fill('#tdText', 'ok'); ok(await page.evaluate(() => document.getElementById('tdSave').disabled), 'too-short lesson cannot be saved');
  await page.fill('#tdText', 'Remember to greet me by name every morning.'); await page.selectOption('#tdWho', 'all'); await page.click('#tdSave');
  await page.click('#teachClose'); await page.waitForTimeout(150);
  await page.reload(); await page.waitForTimeout(2200);
  ok(JSON.stringify(await lessons(page)) === '["all|Remember to greet me by name every morning."]' && (await page.textContent('#teachBtn')).trim() === 'Teach · 1', 'lessons survive a reload');

  // ---- 5. phone width ----
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
  await page.click('#teachBtn'); await page.waitForTimeout(300);
  const fit = await page.evaluate(() => { const d = document.querySelector('#teachDlg').getBoundingClientRect(); return { l: d.left, r: d.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
  ok(fit.l >= 0 && fit.r <= fit.w && fit.sw <= fit.w, 'panel fits a phone: ' + JSON.stringify(fit));
  await page.screenshot({ path: dir + 'vc/teach-phone.png' });

  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
