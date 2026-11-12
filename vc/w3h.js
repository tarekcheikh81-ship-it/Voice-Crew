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
  f.json=function(prompt,opts){window.__calls.push(prompt);(window.__opts=window.__opts||[]).push(opts);var slow=/slow/.test(ownerOf(prompt));return new Promise(function(res){setTimeout(function(){
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
  },slow?2600:400);});};
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
  const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#log .row')].map(r => r.querySelector('b').textContent + ': ' + r.querySelector('.say').textContent.slice(0, 70)));
  const st = (page) => page.evaluate(() => ({ call: !document.getElementById('callbar').hidden, who: document.getElementById('callName').textContent, listen: document.getElementById('listenBtn').textContent, starts: window.__dstarts, calls: window.__calls.length, status: document.getElementById('status').textContent }));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
  await page.addInitScript(stub('true'));
  await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2500);
  console.log('0 listen btn visible', await page.evaluate(() => !document.getElementById('listenBtn').hidden));
  await page.click('#listenBtn'); await page.waitForTimeout(500);
  console.log('1 on', JSON.stringify(await st(page)));
  await page.screenshot({ path: dir + 'vc/h-listen.png' });
  // chatter that is not for the team is ignored
  await page.evaluate(() => window.__say('what a nice day today')); await page.waitForTimeout(2600);
  console.log('2 chatter ignored', JSON.stringify(await st(page)), 'input:', JSON.stringify(await page.inputValue('#input')), 'rows', (await rows(page)).length);
  // a bare name picks up
  await page.evaluate(() => window.__say('Hey Mia')); await page.waitForTimeout(2600);
  console.log('3 bare name', JSON.stringify(await st(page)), JSON.stringify((await rows(page)).slice(-1)), 'spoken', JSON.stringify(await page.evaluate(() => window.__spoken.slice(-1))));
  // talk on the call; the phone-call style and the quick model are used
  await page.evaluate(() => window.__say('our budget is 5k')); await page.waitForTimeout(3200);
  const lastP = await page.evaluate(() => window.__calls[window.__calls.length - 1]); const lastO = await page.evaluate(() => window.__opts[window.__opts.length - 1]);
  console.log('4 live style', /live phone call/.test(lastP), 'tier', lastO.modelTier, lastO.effort, JSON.stringify((await rows(page)).slice(-1)), JSON.stringify(await st(page)));
  // slow answer: a quick "hmm" is spoken while waiting
  const before = await page.evaluate(() => window.__spoken.length);
  await page.evaluate(() => window.__say('this one is slow to answer')); await page.waitForTimeout(5200);
  console.log('5 filler', JSON.stringify(await page.evaluate((n) => window.__spoken.slice(n), before)));
  // goodbye: spoken, call over, still listening for names
  await page.evaluate(() => window.__say('okay bye')); await page.waitForTimeout(2600);
  console.log('6 bye', JSON.stringify(await st(page)), JSON.stringify((await rows(page)).slice(-1)));
  // a name inside a sentence goes straight to them without a call
  await page.evaluate(() => window.__say('Leo what do you think of the screens')); await page.waitForTimeout(3200);
  console.log('7 named', JSON.stringify(await st(page)), JSON.stringify((await rows(page)).slice(-1)));
  await page.click('#listenBtn'); await page.waitForTimeout(500);
  console.log('8 off', JSON.stringify(await st(page)));
  await page.screenshot({ path: dir + 'vc/h-end.png' });
  console.log('ALL SPOKEN', JSON.stringify(await page.evaluate(() => window.__spoken)));
  console.log('call voice label (no call now)');
  console.log('ALL SPOKEN', JSON.stringify(await page.evaluate(() => window.__spoken)));
  console.log('errors', JSON.stringify(errs));
  await ctx.close(); await b.close();
})();
