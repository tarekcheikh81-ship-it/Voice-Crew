const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
const src = fs.readFileSync(dir + 'voice-crew.html', 'utf8');
fs.writeFileSync(dir + 'vc/test-page.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + src + '</body></html>');
const stub = (voice) => `
window.__calls=[];window.__dstarts=0;window.__spoken=[];window.__lines=[];
(function(){
  var ownerOf=function(p){var m=/The owner just said: ([^\\n]*)/.exec(p);return m?m[1]:'';};
  var f=async function(){return {}};
  f.json=function(prompt){window.__calls.push(prompt);return new Promise(function(res){setTimeout(function(){
    var owner=ownerOf(prompt);
    if(/"intro"/.test(prompt)){
      if(/spreadsheet|a sheet|table/i.test(owner))res({intro:'Martina will set that up.',picks:[{role:'Sheets',ask:'build the sheet',covering:null}],noted:[],answered:[]});
      else if(/draft|message to my client/i.test(owner))res({intro:'Freya can write that.',picks:[{role:'Assistant',ask:'draft the message',covering:null}],noted:[],answered:[]});
      else res({intro:'Bringing in Mia.',picks:[{role:'Architect',ask:'stack',covering:null}],noted:[],answered:[]});
    }else if(/"says"/.test(prompt)){
      var m=/You are (\\w+),/.exec(prompt),nm=m?m[1]:'Someone',o={says:nm+' here.',details:null,code:null,handoff:null,noted:[],answered:[]};
      if(/called you by name/.test(prompt))o.says=nm+' here. Happy to answer directly.';
      if(nm==='Martina'&&/table|sheet|csv/i.test(owner)){o.says='Here is the table, ready to paste.';o.code={language:'csv',text:'Name,Amount\\nKarim,120\\nLina,80'};}
      if(/remember/i.test(owner)&&nm==='Freya'){o.says='Noted, I will keep that.';o.noted=[{kind:'fact',text:'Client Karim prefers phone calls.'}];}
      res(o);
    }else res({wrap:'Done.'});
  },300);});};
  var voice=${voice};
  var states=[],finals=[],active=false;
  var dict=voice?{start:function(){active=true;window.__dstarts++;states.forEach(function(g){g({state:'listening'});});return Promise.resolve();},
    stop:function(){active=false;states.forEach(function(g){g({state:'idle',reason:'viewer_stopped'});});return Promise.resolve();},
    active:function(){return active;},onPartial:function(){},onFinal:function(g){finals.push(g);},onState:function(g){states.push(g);}}:null;
  window.__say=function(t){finals.forEach(function(g){g({text:t});});active=false;states.forEach(function(g){g({state:'idle',reason:'stopped'});});};
  var tstates=[],tlines=[];
  var tts=voice?{speak:function(l){return tts.add(l,true);},add:function(l){if(active)return Promise.reject({code:'busy'});var arr=Array.isArray(l)?l:[l];arr.forEach(function(x){window.__spoken.push(x.text);window.__lines.push(x);});
      setTimeout(function(){tstates.forEach(function(g){g({state:'speaking'});});},600);arr.forEach(function(x){tlines.forEach(function(g){g({id:x.id,line:x});});});
      return new Promise(function(r){setTimeout(function(){tstates.forEach(function(g){g({state:'idle',reason:'completed'});});r();},1300);});},
    stop:function(){tstates.forEach(function(g){g({state:'idle',reason:'viewer_stopped'});});return Promise.resolve();},
    onState:function(g){tstates.push(g);},onLine:function(g){tlines.push(g);}}:null;
  window.claude={use:async function(n){if(n==='sample')return f;if(n==='dictation')return dict;if(n==='tts')return tts;return null;}};
})();`;
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const send = async (page, t, wait = 1800) => { await page.fill('#input', t); await page.click('#sendBtn'); await page.waitForTimeout(wait); };
  const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#log .row')].map(r => r.querySelector('b').textContent + ': ' + r.querySelector('.say').textContent.slice(0, 70)));
  const bar = (page) => page.evaluate(() => ({ shown: !document.getElementById('callbar').hidden, name: document.getElementById('callName').textContent, card: (document.querySelector('.card.show .c-name') || {}).textContent }));

  for (const [name, w, h, m] of [['desk', 1280, 800, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
    await page.addInitScript(stub('false'));
    await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2800);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.cn')].map(c => c.textContent.trim()));
    console.log(name, '1 strip', JSON.stringify(chips));
    console.log(name, '1 strip fit', JSON.stringify(await page.evaluate(() => { var n = document.getElementById('cnav'); return { sw: n.scrollWidth, cw: n.clientWidth, docOver: document.documentElement.scrollWidth > innerWidth, liveRight: Math.round(document.getElementById('link').getBoundingClientRect().left), lastRight: Math.round([...document.querySelectorAll('.cn')].pop().getBoundingClientRect().right) }; })));
    await page.screenshot({ path: dir + `vc/q-${name}-overview.png` });
    await page.click('.cn >> nth=8'); await page.waitForTimeout(3200);
    console.log(name, '2 card', JSON.stringify(await page.evaluate(() => ({ n: (document.querySelector('.card.show .c-name') || {}).textContent, r: (document.querySelector('.card.show .c-role') || {}).textContent, task: (document.querySelector('.card.show .c-task') || {}).textContent, duties: [...document.querySelectorAll('.card.show .duties b')].map(x => x.textContent), sec: [...document.querySelectorAll('.card.show .duties li')].map(l => l.dataset.sec) }))));
    await page.screenshot({ path: dir + `vc/q-${name}-card.png` });
    // 3 call her by name: her own prompt; a table comes back as a copyable block
    await send(page, 'Martina, make a table of my clients and amounts', 2200);
    const calls = await page.evaluate(() => window.__calls); const mp = calls[calls.length - 1];
    console.log(name, '3 rows', JSON.stringify((await rows(page)).slice(-1)));
    console.log(name, '3 own intro', /You are Martina, the owner’s specialist for spreadsheets/.test(mp), 'no builder intro', !/Martina, the Sheets on a small software/.test(mp), 'no invent', /Never invent figures/.test(mp), 'csv', /CSV or tab-separated/.test(mp), 'direct', /called you by name/.test(mp));
    console.log(name, '3 code block', JSON.stringify(await page.evaluate(() => { var c = document.querySelector('#log .code'); return c ? { lang: c.querySelector('.lang').textContent, btn: c.querySelector('button').textContent, text: c.querySelector('code').textContent } : null; })));
    await page.screenshot({ path: dir + `vc/q-${name}-table.png` });
    // 4 the lead sends sheet work to Martina and note work to Freya; the builders' chain stays dark
    await page.evaluate(() => { window.__lit = []; window.__iv = setInterval(() => window.__lit.push([...document.querySelectorAll('.cn')].map(c => c.dataset.lit).join('')), 80); });
    await send(page, 'Please set up a spreadsheet for my expenses', 3200);
    const lead = await page.evaluate(() => window.__calls.filter(c => /"intro"/.test(c)).pop());
    console.log(name, '4 lead knows Martina', /Martina \(Sheets\)/.test(lead), /\|"Assistant"\|"Sheets"/.test(lead), /pick Freya, not Martina, for notes and messages/.test(lead));
    console.log(name, '4 rows', JSON.stringify((await rows(page)).slice(-3)));
    console.log(name, '4 chain lit states', JSON.stringify(await page.evaluate(() => { clearInterval(window.__iv); return [...new Set(window.__lit)]; })));
    // 5 builders cannot hand work to the extras; they know them
    await send(page, 'Mia, what stack?', 1800);
    const mi = await page.evaluate(() => window.__calls[window.__calls.length - 1]);
    console.log(name, '5 Mia handoff list excludes extras', /"handoff": \{"role": "Architect"\|"Frontend"\|"Backend"\|"Tester"\|"Reviewer"\|"DevOps", "note"/.test(mi), 'knows Martina', /Martina \(Sheets\)/.test(mi), 'knows Freya', /Freya \(Assistant\)/.test(mi));
    // 6 calls, including a misheard spelling
    await send(page, 'Martina, open a call', 2200);
    console.log(name, '6 call', JSON.stringify(await bar(page)), JSON.stringify((await rows(page)).slice(-1)));
    await page.screenshot({ path: dir + `vc/q-${name}-call.png` });
    await send(page, 'hang up', 900);
    await send(page, 'call me Martine', 1500);
    console.log(name, '6b misheard', JSON.stringify(await bar(page)));
    await send(page, 'bye', 900);
    // 7 cross cover: Martina off -> Freya covers; both off -> nobody; Mia off -> Jimmy
    await page.click('.cn >> nth=8'); await page.waitForTimeout(3000);
    await page.click('.card.show .sw'); await page.waitForTimeout(300);
    console.log(name, '7 Martina off', JSON.stringify(await page.evaluate(() => (document.querySelector('.card.show .note') || {}).textContent)), JSON.stringify(await page.textContent('#status')));
    await page.click('.card.show .c-call'); await page.waitForTimeout(1500);
    console.log(name, '7 call Martina while off', JSON.stringify(await bar(page)), JSON.stringify((await rows(page)).slice(-1)));
    await page.click('#callEnd'); await page.waitForTimeout(300);
    await page.click('.cn >> nth=7'); await page.waitForTimeout(3000);
    console.log(name, '7 Freya covering', JSON.stringify(await page.evaluate(() => (document.querySelector('.card.show .note') || {}).textContent)));
    await page.click('.card.show .sw'); await page.waitForTimeout(300);
    console.log(name, '7 both off', JSON.stringify(await page.evaluate(() => (document.querySelector('.card.show .note') || {}).textContent)), JSON.stringify(await page.textContent('#status')));
    await page.click('.card.show .c-call'); await page.waitForTimeout(600);
    console.log(name, '7 call both off', JSON.stringify(await bar(page)), JSON.stringify(await page.textContent('#status')));
    await page.click('.card.show .sw'); await page.waitForTimeout(200);
    await page.click('.cn >> nth=8'); await page.waitForTimeout(3000);
    await page.click('.card.show .sw'); await page.waitForTimeout(200);
    await page.click('.cn >> nth=1'); await page.waitForTimeout(3000);
    await page.click('.card.show .sw'); await page.waitForTimeout(300);
    console.log(name, '7 Mia off cover', JSON.stringify(await page.evaluate(() => (document.querySelector('.card.show .note') || {}).textContent)));
    await page.click('.card.show .sw'); await page.waitForTimeout(200);
    console.log(name, 'errors', JSON.stringify(errs));
    await ctx.close();
  }
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
    await page.addInitScript(stub('true'));
    await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2800);
    await send(page, 'Martina, open a call', 2200);
    await page.evaluate(() => window.__say('make me a table of my clients')); await page.waitForTimeout(3800);
    console.log('voice lines', JSON.stringify(await page.evaluate(() => window.__lines.map(l => ({ t: l.text.slice(0, 40), id: l.id, voice: l.voice, rate: l.rate })))));
    await page.evaluate(() => window.__say('goodbye')); await page.waitForTimeout(900);
    await page.click('#voiceBtn'); await page.waitForTimeout(300);
    console.log('voices panel', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#voiceList .vrow')].map(r => r.querySelector('b').textContent + '=' + r.querySelector('select').value))));
    await page.click('#voiceClose'); await page.waitForTimeout(200);
    console.log('voice errors', JSON.stringify(errs));
    await ctx.close();
  }
  await b.close();
})();
