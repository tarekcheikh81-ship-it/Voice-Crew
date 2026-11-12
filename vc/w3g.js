const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
const src = fs.readFileSync(dir + 'voice-crew.html', 'utf8');
fs.writeFileSync(dir + 'vc/test-page.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + src + '</body></html>');
const stub = (voice) => `
window.__calls=[];window.__dstarts=0;window.__spoken=[];
(function(){
  var ownerOf=function(p){var m=/The owner just said: ([^\\n]*)/.exec(p);return m?m[1]:'';};
  var f=async function(){return {}};
  f.json=function(prompt){window.__calls.push(prompt);return new Promise(function(res){setTimeout(function(){
    var owner=ownerOf(prompt);
    if(/"intro"/.test(prompt)){
      res({intro:'Bringing in Mia.',picks:[{role:'Architect',ask:'stack',covering:null}],noted:/iphone/i.test(owner)?[{kind:'fact',text:'The app is for iPhone only.'}]:[],answered:[]});
    }else if(/"says"/.test(prompt)){
      var m=/You are (\\w+),/.exec(prompt),nm=m?m[1]:'Someone',o={says:nm+' here.',details:null,code:null,handoff:null,noted:[],answered:[]};
      if(/budget/i.test(owner)){o.says='Got it, the budget is 5k. What is the deadline?';o.noted=[{kind:'fact',text:'Budget is 5k dollars.'},{kind:'question',text:'What is the deadline?'}];}
      else if(/deadline/i.test(owner)){var q=/Q(\\d+):/.exec(prompt);o.says='March, noted.';o.answered=q?['Q'+q[1]]:[];o.noted=[{kind:'fact',text:'Deadline is March.'}];}
      else if(/called you by name/.test(prompt))o.says=nm+' here. Happy to answer directly.';
      res(o);
    }else res({wrap:'Done.'});
  },400);});};
  var voice=${voice};
  var states=[],finals=[],lines=[],active=false;
  var dict=voice?{start:function(){active=true;window.__dstarts++;states.forEach(function(g){g({state:'listening'});});return Promise.resolve();},
    stop:function(){active=false;states.forEach(function(g){g({state:'idle',reason:'viewer_stopped'});});return Promise.resolve();},
    active:function(){return active;},onPartial:function(){},onFinal:function(g){finals.push(g);},onState:function(g){states.push(g);}}:null;
  window.__say=function(t){finals.forEach(function(g){g({text:t});});active=false;states.forEach(function(g){g({state:'idle',reason:'stopped'});});};
  var tstates=[],tlines=[];
  var tts=voice?{speak:function(l){return tts.add(l,true);},add:function(l){if(active)return Promise.reject({code:'busy'});var arr=Array.isArray(l)?l:[l];arr.forEach(function(x){window.__spoken.push(x.text);});
      setTimeout(function(){tstates.forEach(function(g){g({state:'speaking'});});},600);arr.forEach(function(x){tlines.forEach(function(g){g({id:x.id,line:x});});});
      return new Promise(function(r){setTimeout(function(){tstates.forEach(function(g){g({state:'idle',reason:'completed'});});r();},1300);});},
    stop:function(){tstates.forEach(function(g){g({state:'idle',reason:'viewer_stopped'});});return Promise.resolve();},
    onState:function(g){tstates.push(g);},onLine:function(g){tlines.push(g);}}:null;
  window.claude={use:async function(n){if(n==='sample')return f;if(n==='dictation')return dict;if(n==='tts')return tts;return null;}};
})();`;
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const send = async (page, t, wait = 2200) => { await page.fill('#input', t); await page.click('#sendBtn'); await page.waitForTimeout(wait); };
  const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#log .row')].map(r => r.querySelector('b').textContent + ': ' + r.querySelector('.say').textContent.slice(0, 60)));
  const bar = (page) => page.evaluate(() => ({ shown: !document.getElementById('callbar').hidden, name: document.getElementById('callName').textContent, ph: document.getElementById('input').placeholder, card: (document.querySelector('.card.show .c-name') || {}).textContent, tgt: !document.getElementById('target').hidden }));
  for (const [name, w, h, m] of [['desk', 1280, 800, false], ['phone', 390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
    await page.addInitScript(stub('false'));
    await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2500);
    console.log(name, 'notes btn', await page.textContent('#notesBtn'));
    // 1 call by asking
    await send(page, 'Mia, open a call', 2500);
    console.log(name, '1 voice label', await page.textContent('#callVoice'), await page.getAttribute('#callVoice','data-ok'), 'status', await page.textContent('#status')); console.log(name, '1 call', JSON.stringify(await bar(page)), 'model calls', await page.evaluate(() => window.__calls.length), JSON.stringify((await rows(page)).slice(-1)));
    await page.screenshot({ path: dir + `vc/g-${name}-call.png` });
    // 2 info collected
    await send(page, 'Our budget is 5k', 2500);
    console.log(name, '2 reply', JSON.stringify((await rows(page)).slice(-1)), 'noted:', await page.evaluate(() => [...document.querySelectorAll('#log .row:last-child .noted li')].map(l => l.textContent)), 'btn', await page.textContent('#notesBtn'));
    // 3 follow-up answers the open question and the notes reach the prompt
    await send(page, 'The deadline is in March', 2500);
    const last = await page.evaluate(() => window.__calls[window.__calls.length - 1]);
    console.log(name, '3 prompt has notes', /already collected/.test(last), /Q1: What is the deadline/.test(last), /Budget is 5k/.test(last));
    console.log(name, '3 noted', await page.evaluate(() => [...document.querySelectorAll('#log .row:last-child .noted li')].map(l => l.textContent)), 'btn', await page.textContent('#notesBtn'));
    // 4 notes dialog
    await page.click('#notesBtn'); await page.waitForTimeout(300);
    console.log(name, '4 dialog rows', await page.evaluate(() => [...document.querySelectorAll('#ndList .nrow')].map(r => r.textContent.replace(/\s+/g, ' ').slice(0, 70))), 'open hdr', await page.evaluate(() => !!document.querySelector('.nd-h')));
    await page.screenshot({ path: dir + `vc/g-${name}-notes.png` });
    await page.click('.nrow .n-del >> nth=0'); await page.waitForTimeout(200);
    console.log(name, '4 after delete', await page.evaluate(() => document.querySelectorAll('#ndList .nrow').length), await page.textContent('#notesBtn'));
    await page.click('#ndCopyBtn'); await page.waitForTimeout(300);
    console.log(name, '4 copy label', await page.textContent('#ndCopyBtn'));
    await page.click('#notesClose'); await page.waitForTimeout(200);
    // 5 end the call
    await send(page, 'ok, end the call', 800);
    console.log(name, '5 ended', JSON.stringify(await bar(page)));
    // 6 call Leo, hang up
    await send(page, 'call Leo', 1500);
    console.log(name, '6 call Leo', JSON.stringify(await bar(page)), JSON.stringify((await rows(page)).slice(-1)));
    await send(page, 'hang up', 800);
    console.log(name, '6 hang up', JSON.stringify(await bar(page)));
    // 7 naming Jimmy in a sentence about an API call must not open a call
    await send(page, 'Jimmy, how should the API call work?', 2200);
    console.log(name, '7 no call', JSON.stringify(await bar(page)), JSON.stringify((await rows(page)).slice(-1)));
    // 8 Jimmy offline, call him
    await page.click('.cn >> nth=3'); await page.waitForTimeout(2800);
    await page.click('.card.show .sw'); await page.waitForTimeout(300);
    await page.click('.card.show .c-call'); await page.waitForTimeout(1500);
    console.log(name, '8 cover call', JSON.stringify(await bar(page)), JSON.stringify((await rows(page)).slice(-1)));
    await page.click('#callEnd'); await page.waitForTimeout(300);
    console.log(name, '8 end btn', JSON.stringify(await bar(page)));
    // 9 lead flow collects too
    await send(page, 'It is for iPhone only', 4200);
    console.log(name, '9 lead noted', await page.evaluate(() => [...document.querySelectorAll('#log .noted li')].map(l => l.textContent)));
    // 10 Mia's card shows what she collected
    await page.click('.cn >> nth=1'); await page.waitForTimeout(3000);
    console.log(name, '10 card notes', await page.evaluate(() => { var c = document.querySelector('.card.show .c-notes'); return c && !c.hidden ? c.textContent.replace(/\s+/g, ' ') : 'hidden'; }));
    await page.screenshot({ path: dir + `vc/g-${name}-card.png` });
    // 11 persisted
    await page.reload(); await page.waitForTimeout(2500);
    console.log(name, '11 after reload', await page.textContent('#notesBtn'));
    console.log(name, 'errors', JSON.stringify(errs));
    await ctx.close();
  }
  // hands-free voice loop (desktop)
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
    await page.addInitScript(stub('true'));
    await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2500);
    await send(page, 'Mia, open a call', 2000);
    console.log('voice 1 spoken', JSON.stringify(await page.evaluate(() => window.__spoken)), 'dict starts', await page.evaluate(() => window.__dstarts), 'status:', await page.textContent('#status'));
    await page.evaluate(() => window.__say('our budget is 5k')); await page.waitForTimeout(2800);
    console.log('voice 2 rows', JSON.stringify((await rows(page)).slice(-2)), 'dict starts', await page.evaluate(() => window.__dstarts), 'btn', await page.textContent('#notesBtn'));
    await page.evaluate(() => window.__say('goodbye')); await page.waitForTimeout(800);
    console.log('voice 3 ended', JSON.stringify(await bar(page)), 'errors', JSON.stringify(errs));
    await ctx.close();
  }
  await b.close();
})();
