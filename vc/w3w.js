const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
const src = fs.readFileSync(dir + 'voice-crew.html', 'utf8');
fs.writeFileSync(dir + 'vc/test-page.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + src.replace(/<!doctype html>[\s\S]*?<body>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '') + '</body></html>');
const stub = (voice) => `
window.__calls=[];window.__spoken=[];window.__speaks=[];window.__plays=0;window.__hidden=false;
Object.defineProperty(document,'hidden',{get:function(){return window.__hidden;}});
HTMLMediaElement.prototype.play=function(){window.__plays++;this.__p=true;return Promise.resolve();};
HTMLMediaElement.prototype.pause=function(){this.__p=false;};
(function(){
  var ownerOf=function(p){var m=/The owner just said: ([^\\n]*)/.exec(p);return m?m[1]:'';};
  var f=async function(){return {}};
  f.json=function(prompt,opts){
    window.__calls.push(prompt);var owner=ownerOf(prompt),slow=/slow/.test(owner);
    var full;
    if(/"intro"/.test(prompt))full={intro:'Bringing in Mia and Leo.',picks:[{role:'Architect',ask:'schema',covering:null},{role:'Frontend',ask:'screen',covering:null}],noted:[],answered:[]};
    else if(/"says"/.test(prompt)){
      var m=/You are (\\w+),/.exec(prompt),nm=m?m[1]:'Someone';
      full=nm==='Leo'?{says:'Here is the login screen, ready to paste.',details:null,code:{language:'html',text:'<div>\\n  <h1>Login</h1>\\n  <form>\\n    <input name="email">\\n  </form>\\n</div>'},handoff:null,noted:[],answered:[]}
        :{says:nm+' here. I would keep the sessions short and use a simple token flow, then hand the schema to the backend.',details:null,code:null,handoff:null,noted:[],answered:[]};
    }else full={wrap:'All set.'};
    return new Promise(function(res,rej){
      var txt=JSON.stringify(full),n=0,sig=opts&&opts.signal;
      var iv=setInterval(function(){n+=Math.ceil(txt.length/(slow?12:6));if(opts&&opts.onText)opts.onText({text:txt.slice(0,n),delta:''});if(n>=txt.length){clearInterval(iv);res(full);}},slow?400:350);
      if(sig)sig.addEventListener('abort',function(){clearInterval(iv);rej({code:'cancelled'});});
    });
  };
  var voice=${voice};
  var states=[],finals=[],partials=[],active=false;
  var dict=voice?{start:function(){active=true;states.forEach(function(g){g({state:'listening'});});return Promise.resolve();},
    stop:function(){active=false;states.forEach(function(g){g({state:'idle',reason:'viewer_stopped'});});return Promise.resolve();},
    active:function(){return active;},onPartial:function(g){partials.push(g);},onFinal:function(g){finals.push(g);},onState:function(g){states.push(g);}}:null;
  window.__say=function(t){finals.forEach(function(g){g({text:t});});};
  var tstates=[],tlines=[];
  var gen=0;window.__ttsIdle=function(reason){gen++;tstates.forEach(function(g){g({state:'idle',reason:reason});});};
  window.__ttsLine=function(id){tlines.forEach(function(g){g({id:id});});};
  var tts=voice?{speak:function(l){var arr=Array.isArray(l)?l:[l];window.__speaks.push(arr.map(function(x){return x.text;}));return tts.add(l,true);},
    add:function(l){if(active)return Promise.reject({code:'busy'});var arr=Array.isArray(l)?l:[l];arr.forEach(function(x){window.__spoken.push(x.text);});
      var gg=gen;setTimeout(function(){if(gg===gen)tstates.forEach(function(g){g({state:'speaking'});});},300);arr.forEach(function(x){tlines.forEach(function(g){g({id:x.id,line:x});});});
      if(window.__holdTts)return new Promise(function(){});
      return new Promise(function(r){setTimeout(function(){tstates.forEach(function(g){g({state:'idle',reason:'completed'});});r();},900);});},
    stop:function(){tstates.forEach(function(g){g({state:'idle',reason:'viewer_stopped'});});return Promise.resolve();},
    onState:function(g){tstates.push(g);},onLine:function(g){tlines.push(g);}}:null;
  window.claude={use:async function(n){if(n==='sample')return f;if(n==='dictation')return dict;if(n==='tts')return tts;return null;}};
})();`;
const bulk = (page, text) => page.evaluate((t) => { const i = document.getElementById('input'); i.focus(); i.value = t; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: t, bubbles: true })); }, text);
const key = (page, ch) => page.evaluate((c) => { const i = document.getElementById('input'); i.value += c; i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: c, bubbles: true })); }, ch);
const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#log .row, #log .msg')].map(r => (r.querySelector('b') ? r.querySelector('b').textContent : 'You') + ': ' + (r.querySelector('.say') || r).textContent.replace(/\s+/g, ' ').slice(0, 60)));
const workState = (page) => page.evaluate(() => { const w = document.getElementById('work'); return { hidden: w.hidden, cards: [...w.querySelectorAll('.wk')].map(c => ({ id: c.dataset.id, st: c.dataset.state, label: c.querySelector('.wk-st').textContent, bar: c.querySelector('.wk-bar i').style.width, prev: c.querySelector('.wk-prev').textContent.slice(0, 60) })) }; });
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const mk = async (vw, vh, voice) => {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
    await page.addInitScript(stub(voice));
    await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2200);
    return { ctx, page, errs };
  };
  // ---------- A. the Now working panel ----------
  for (const [tag, vw, vh] of [['desk', 1280, 800], ['phone', 390, 844]]) {
    const { ctx, page, errs } = await mk(vw, vh, 'false');
    console.log(tag, 'A0 hidden at start', JSON.stringify(await workState(page)));
    await page.fill('#input', 'build the login screen'); await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    console.log(tag, 'A1 lead planning', JSON.stringify(await workState(page)));
    await page.waitForTimeout(2300);
    console.log(tag, 'A2 mid', JSON.stringify(await workState(page)));
    await page.screenshot({ path: dir + 'vc/w-' + tag + '-mid.png' });
    await page.waitForTimeout(1500);
    const mid2 = await workState(page);
    console.log(tag, 'A3 later', JSON.stringify(mid2));
    await page.waitForTimeout(3500);
    console.log(tag, 'A4 end', JSON.stringify(await workState(page)));
    await page.screenshot({ path: dir + 'vc/w-' + tag + '-end.png' });
    await page.waitForTimeout(9500);
    console.log(tag, 'A5 gone', JSON.stringify(await workState(page)));
    console.log(tag, 'errors', JSON.stringify(errs));
    await ctx.close();
  }
  // ---------- B. hands-free calls ----------
  {
    const { ctx, page, errs } = await mk(1280, 800, 'true');
    const callOn = () => page.evaluate(() => ({ call: !document.getElementById('callbar').hidden, who: document.getElementById('callName').textContent, ph: document.getElementById('input').placeholder }));
    await page.fill('#input', 'call Mia'); await page.keyboard.press('Enter'); await page.waitForTimeout(1800);
    console.log('B0 call', JSON.stringify(await callOn()), 'status:', await page.textContent('#status'));
    const n0 = (await rows(page)).length;
    await bulk(page, 'what is the plan for tomorrow'); await page.waitForTimeout(1200);
    console.log('B1 not sent yet (1.2s)', (await rows(page)).length === n0, JSON.stringify(await page.inputValue('#input')));
    await page.waitForTimeout(1500);
    console.log('B2 sent after pause', (await rows(page)).length > n0, JSON.stringify(await page.inputValue('#input')), JSON.stringify((await rows(page)).slice(-2)));
    await page.waitForTimeout(2500);
    // typing key by key is not cut off mid sentence
    const n1 = (await rows(page)).length;
    for (const ch of 'hello') { await key(page, ch); await page.waitForTimeout(200); }
    await page.waitForTimeout(2600);
    console.log('B3 typing waits (3s)', (await rows(page)).length === n1, JSON.stringify(await page.inputValue('#input')));
    await page.waitForTimeout(2800);
    console.log('B4 typed text goes after 5s', (await rows(page)).length > n1, JSON.stringify(await page.inputValue('#input')));
    await page.waitForTimeout(2500);
    // goodbye while the team is still working: the call ends and the farewell is spoken
    await bulk(page, 'this one is slow to answer'); await page.waitForTimeout(3300);
    const busyNow = await page.evaluate(() => !document.getElementById('stopBtn').hidden);
    await bulk(page, 'ok that is all, thanks, goodbye Mia'); await page.waitForTimeout(2900);
    console.log('B5 goodbye while busy', 'busy was', busyNow, JSON.stringify(await callOn()), JSON.stringify((await rows(page)).slice(-2)), 'spoken tail', JSON.stringify(await page.evaluate(() => window.__spoken.slice(-1))), 'input', JSON.stringify(await page.inputValue('#input')));
    await page.screenshot({ path: dir + 'vc/w-desk-bye.png' });
    console.log('errors', JSON.stringify(errs));
    await ctx.close();
  }
  // ---------- C. the voice keeps going when the page is hidden ----------
  {
    const { ctx, page, errs } = await mk(1280, 800, 'true');
    window_ = null;
    await page.fill('#input', 'call Mia'); await page.keyboard.press('Enter'); await page.waitForTimeout(1600);
    console.log('C0 quiet audio started', await page.evaluate(() => window.__plays), 'media title', await page.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title));
    // a long reading is cut off by the browser while the tab is hidden
    await page.evaluate(() => { window.__holdTts = true; });
    await page.evaluate(() => { window.__speaks.length = 0; });
    await page.fill('#input', 'tell me about the plan'); await page.keyboard.press('Enter');
    for (let k = 0; k < 40; k++) { await page.waitForTimeout(250); if (await page.evaluate(() => /keep the sessions short/.test(window.__spoken.slice(-1)[0] || ''))) break; }
    await page.waitForTimeout(500);
    console.log('C1 speaking', JSON.stringify(await page.evaluate(() => window.__spoken.slice(-1))), 'title', await page.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title));
    await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.__ttsIdle('interrupted'); });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__holdTts = false; window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(900);
    console.log('C2 picked up again on return', JSON.stringify(await page.evaluate(() => window.__speaks)));
    // a normal ending while hidden is not repeated
    await page.evaluate(() => { window.__speaks.length = 0; window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.__ttsIdle('completed'); window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(700);
    console.log('C3 nothing repeated after a normal finish', JSON.stringify(await page.evaluate(() => window.__speaks)));
    await page.evaluate(() => document.getElementById('callEnd').click()); await page.waitForTimeout(800);
    console.log('C4 media cleared after the call', await page.evaluate(() => navigator.mediaSession.metadata));
    console.log('errors', JSON.stringify(errs));
    await ctx.close();
  }
  await b.close();
})();
