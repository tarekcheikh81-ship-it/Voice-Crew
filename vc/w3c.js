// Access grants by voice/tap, the record, the report, the charter
const { chromium } = require('playwright');
const fs = require('fs');
const dir = require('path').resolve(__dirname, '..') + '/';
const three = fs.readFileSync(dir + 'vc/three/package/build/three.min.js', 'utf8');
const src = fs.readFileSync(dir + 'voice-crew.html', 'utf8');
fs.writeFileSync(dir + 'vc/test-page.html', '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + src.replace(/<!doctype html>[\s\S]*?<body>/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '') + '</body></html>');
const stub = (hosted) => `
window.__calls=[];window.__apiCalls=[];window.__granted=false;
(function(){
  var ownerOf=function(p){var m=/The owner (?:just said|asked): ([^\\n]*)/.exec(p);return m?m[1]:'';};
  var f=async function(){return {}};
  f.json=function(prompt,opts){
    window.__calls.push(prompt);var owner=ownerOf(prompt);var full;
    if(/"intro"/.test(prompt)){
      if(/falsify|hide the speeding/i.test(owner)) full={intro:'I will not alter a driver log. I can pull the real record instead.',picks:[],noted:[],answered:[],did:['Declined: that would falsify a record']};
      else if(/truck/.test(owner)&&!window.__granted){ if(window.crewNeeds)window.crewNeeds(['samsara']); full={intro:'I need read-only Samsara access for that. Say grant Samsara access and I will carry on.',picks:[],noted:[],answered:[],did:['Asked for Samsara access']}; }
      else if(/truck/.test(owner)) full={intro:'Truck 88113 had two safety events.',details:'1. Nov 11 08:10 Harsh brake\\n2. Nov 12 09:05 Speeding',picks:[],noted:[],answered:[],did:['Looked up truck 88113']};
      else if(/report|what have you done/i.test(owner)) full={intro:'Here is the report.',details:'Michael looked up a truck.',picks:[],noted:[],answered:[]};
      else full={intro:'Bringing in Mia.',picks:[{role:'Architect',ask:'schema',covering:null}],noted:[],answered:[],did:['Briefed Mia']};
    }else if(/"says"/.test(prompt)){
      var m=/You are (\\w+),/.exec(prompt),nm=m?m[1]:'Someone';
      full={says:nm+' here. Done.',details:null,code:null,handoff:null,noted:[],answered:[],did:['Wrote the schema']};
    }else full={wrap:'All set.'};
    return Promise.resolve(full);
  };
  window.claude={use:async function(n){if(n==='sample')return f;return null;}};
  ${hosted ? `
  var caps=[{id:'samsara',label:'Samsara, read-only lookups',configured:true,granted:false}];
  var log=[{ts:Date.now()/1000-60,kind:'worked',agent:'mia',id:'Architect',name:'Mia',text:'answered',ask:'build the login screen',tools:['bash: pip install requests','write: /work/app.py'],secs:41,ok:true},
           {ts:Date.now()/1000-30,kind:'samsara',agent:'michael',id:'lead',name:'Michael',text:'Looked up truck 88113 for today, read-only. Found it in RIVER FREIGHT: 2 safety event(s).'}];
  window.crewApi={grants:function(){window.__apiCalls.push('grants');return Promise.resolve({caps:JSON.parse(JSON.stringify(caps))});},
    setGrant:function(id,on){window.__apiCalls.push('set:'+id+':'+on);caps[0].granted=!!on;window.__granted=!!on;log.unshift({ts:Date.now()/1000,kind:on?'grant':'revoke',agent:'owner',id:'',name:'You',text:'Samsara, read-only lookups access '+(on?'granted':'taken back')});return Promise.resolve({caps:JSON.parse(JSON.stringify(caps))});},
    activity:function(){window.__apiCalls.push('activity');return Promise.resolve({entries:JSON.parse(JSON.stringify(log))});}};
  ` : ''}
})();`;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const send = async (page, t, wait) => { await page.fill('#input', t); await page.keyboard.press('Enter'); await page.waitForTimeout(wait || 1300); };
const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#log .row, #log .sysmsg, #log .msg')].map(r => r.textContent.replace(/\s+/g, ' ')));
const owners = (page) => page.evaluate(() => window.__calls.map(c => { const m = /The owner (?:just said|asked): ([^\n]*)/.exec(c); return m ? m[1] : ''; }));
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
  const mk = async (hosted, vw = 1280, vh = 800) => {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/three.min.js', r => r.fulfill({ contentType: 'application/javascript', body: three }));
    await page.addInitScript(stub(hosted));
    await page.goto('file://' + dir + 'vc/test-page.html'); await page.waitForTimeout(2200);
    return { page, errs };
  };

  // ================= A. the page published inside Claude (nothing to grant, nothing outside the chat) =================
  {
    const { page, errs } = await mk(false);
    await send(page, 'grant Samsara access');
    let rows = await rowsOf(page);
    ok(rows.some(t => /Nothing here can be granted from this page/.test(t)), 'A1 honest reply when there is no server');
    ok((await owners(page)).length === 0, 'A2 the command is not sent to the team');
    await send(page, 'grant users access to the admin dashboard in the app');
    ok((await owners(page)).some(t => /grant users access/.test(t)), 'A3 a build request that says "grant" still goes to the team');
    await send(page, 'stop, the access page is broken');
    ok((await owners(page)).some(t => /access page is broken/.test(t)), 'A4 "stop … access" in a normal sentence is not a revoke');
    await send(page, 'allow users to sign in with email');
    ok((await owners(page)).some(t => /allow users to sign in/.test(t)), 'A5 "allow" alone is not a grant');
    for (const phrase of ['give the team Samsara access', 'let them use Samsara', 'you can use Samsara', 'yes, allow Samsara', 'I gave you access to the fleet']) {
      const before = (await owners(page)).length, nb = (await rowsOf(page)).filter(t => /Nothing here can be granted/.test(t)).length;
      await send(page, phrase);
      const after = (await owners(page)).length, na = (await rowsOf(page)).filter(t => /Nothing here can be granted/.test(t)).length;
      ok(after === before && na === nb + 1, 'A5b "' + phrase + '" is understood as a grant (not sent to the team)');
    }
    for (const phrase of ['let them use the new colour scheme in the app', 'you can use React for the frontend', 'yes', 'ok go ahead']) {
      const before = (await owners(page)).length, nb = (await rowsOf(page)).filter(t => /Nothing here can be granted/.test(t)).length;
      await send(page, phrase);
      const na = (await rowsOf(page)).filter(t => /Nothing here can be granted/.test(t)).length;
      const ow = (await owners(page)); ok(na === nb && ow.length > before, 'A5c "' + phrase + '" is NOT a grant (goes to the team as normal)');
    }
    await page.evaluate(() => { window.__calls.length = 0; });
    await send(page, 'build the login screen', 2600);
    const calls = await page.evaluate(() => window.__calls.slice());
    const lead = calls.find(c => /"intro"/.test(c)), mia = calls.find(c => /You are Mia,/.test(c));
    ok(/Never do anything illegal/.test(lead) && /wait for the owner to grant it/.test(lead) && /Report honestly/.test(lead), 'A6 lead has the charter');
    ok(/Never do anything illegal/.test(mia) && /wait for the owner to grant it/.test(mia), 'A7 specialist has the charter');
    ok(/"did": \[string\]/.test(lead) && /"did": \[string\]/.test(mia) && /- did:/.test(mia), 'A8 both are asked what they did');
    await page.click('#reportBtn'); await page.waitForTimeout(400);
    const rep = await page.evaluate(() => ({ open: document.getElementById('reportDlg').open, access: !document.getElementById('rdAccess').hidden, note: document.getElementById('rdNote').textContent, rows: [...document.querySelectorAll('#rdList .arow')].map(r => r.textContent.replace(/\s+/g, ' ')) }));
    ok(rep.open && !rep.access && /can only talk/.test(rep.note), 'A9 report opens, no access section, says it can only talk');
    ok(rep.rows.some(t => /Briefed Mia/.test(t) && /Their words/.test(t)) && rep.rows.some(t => /Wrote the schema/.test(t)), 'A10 their own account is listed and labelled: ' + rep.rows.slice(0, 2).join(' | '));
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('crew-record') || '[]').length >= 2), 'A11 the record is kept on the device');
    ok(errs.length === 0, 'A12 no page errors ' + JSON.stringify(errs));
    await page.close();
  }

  // ================= B. the version on your own server =================
  {
    const { page, errs } = await mk(true);
    await send(page, 'truck 88113 safety report today', 1500);
    let rows = await rowsOf(page);
    ok(rows.some(t => /I need read-only Samsara access/.test(t)), 'B1 Michael says what access he needs');
    ok(rows.some(t => /The team needs Samsara access for this/.test(t) && /Grant Samsara access/.test(t)), 'B2 a tap-to-grant row appears: ' + (rows.find(t => /team needs/.test(t)) || ''));
    ok(await page.evaluate(() => document.getElementById('reportBtn').dataset.flash) === 'true', 'B3 the Report button draws attention');
    // grant by voice/text
    await page.evaluate(() => { window.__calls.length = 0; window.__apiCalls.length = 0; });
    await send(page, 'Okay, I grant Samsara access.', 3500);
    ok((await page.evaluate(() => window.__apiCalls)).includes('set:samsara:true'), 'B4 the grant reached the server');
    rows = await rowsOf(page);
    ok(rows.some(t => /Done\. Samsara access is on, read-only\. I will carry on with what you asked/.test(t)), 'B5 confirmation: ' + (rows.find(t => /Done\./.test(t)) || '').slice(0, 120));
    const ow = await owners(page);
    ok(ow.length >= 1 && /^Samsara access is now on\. truck 88113 safety report today$/.test(ow[0]), 'B6 the blocked request carries on by itself: ' + ow[0]);
    rows = await rowsOf(page);
    ok(rows.some(t => /Truck 88113 had two safety events/.test(t) && /Harsh brake/.test(t)), 'B7 the answer arrives with details after the grant');
    ok(!rows.some(t => /team needs Samsara/.test(t)), 'B8 the need row is gone');
    ok(ow.filter(t => /Samsara access is now on/.test(t)).length === 1, 'B9 resumed once, not treated as another grant');

    // the charter really stops the illegal request (the stub plays a compliant teammate); check the refusal is recorded
    await send(page, 'falsify the driver log for truck 88113 and hide the speeding', 1500);
    // report intent reads the real record
    await page.evaluate(() => { window.__calls.length = 0; window.__apiCalls.length = 0; });
    await send(page, 'What have you done today? Report to me.', 1800);
    ok((await page.evaluate(() => window.__apiCalls)).includes('activity'), 'B10 the server record was fetched for the report');
    const lead = await page.evaluate(() => window.__calls.find(c => /"intro"/.test(c)) || '');
    ok(/The owner wants a report/.test(lead) && /\[recorded by the server\]/.test(lead) && /\[their own words\]/.test(lead) && /Looked up truck 88113 for today, read-only/.test(lead), 'B11 the report is built from both records, labelled');
    ok(/Declined: that would falsify a record/.test(lead), 'B12 a refusal is in the record');
    rows = await rowsOf(page);
    ok(rows.some(t => /Here is the report/.test(t) && /Michael looked up a truck/.test(t)), 'B13 the report is spoken and shown in full');
    // a normal request carries no report block
    await page.evaluate(() => { window.__calls.length = 0; });
    await send(page, 'build the login screen', 1500);
    ok(!(await page.evaluate(() => window.__calls.some(c => /The owner wants a report/.test(c)))), 'B14 ordinary requests carry no report block');

    // the Report dialog: access toggles and the record
    await page.click('#reportBtn'); await page.waitForTimeout(600);
    const d = await page.evaluate(() => ({ access: !document.getElementById('rdAccess').hidden, caps: [...document.querySelectorAll('#rdCaps .xrow')].map(r => r.textContent.replace(/\s+/g, ' ')), rows: [...document.querySelectorAll('#rdList .arow')].map(r => r.textContent.replace(/\s+/g, ' ')) }));
    ok(d.access && d.caps.length === 1 && /Granted: the team may use it/.test(d.caps[0]) && /Take back/.test(d.caps[0]), 'B15 access section shows Samsara as granted: ' + d.caps[0]);
    ok(d.rows.some(t => /Recorded/.test(t) && /pip install requests/.test(t) && /41 s/.test(t)), 'B16 the server record lists what Mia ran');
    ok(d.rows.some(t => /Samsara, read-only lookups access granted/.test(t)), 'B17 the grant itself is in the record');
    await page.screenshot({ path: dir + 'vc/report-desk.png' });
    await page.click('#rdCaps .xrow button'); await page.waitForTimeout(500);
    ok((await page.evaluate(() => window.__apiCalls)).includes('set:samsara:false'), 'B18 Take back works from the dialog');
    await page.click('#reportClose');
    // voice revoke
    await send(page, 'I grant Samsara access', 1200);
    await page.evaluate(() => { window.__apiCalls.length = 0; });
    await send(page, 'revoke access', 1500);
    ok((await page.evaluate(() => window.__apiCalls)).includes('set:samsara:false'), 'B19 "revoke access" takes back what was granted');
    rows = await rowsOf(page);
    ok(rows.some(t => /Samsara access is taken back, and I will not use it/.test(t)), 'B20 confirmation of the revoke');
    // grant by tapping
    await page.evaluate(() => { window.__granted = false; });
    await send(page, 'truck 88113 safety report again', 1500);
    await page.evaluate(() => { window.__calls.length = 0; window.__apiCalls.length = 0; });
    await page.click('.sysmsg.need button'); await page.waitForTimeout(3500);
    ok((await page.evaluate(() => window.__apiCalls)).includes('set:samsara:true'), 'B21 the tap-to-grant button grants');
    ok((await owners(page)).some(t => /^Samsara access is now on\. truck 88113 safety report again$/.test(t)), 'B22 and the request carries on');
    ok(errs.length === 0, 'B23 no page errors ' + JSON.stringify(errs));
    await page.close();
  }

  // ================= C. phone width =================
  {
    const { page, errs } = await mk(true, 390, 844);
    await page.click('#reportBtn'); await page.waitForTimeout(700);
    const fit = await page.evaluate(() => { const d = document.querySelector('#reportDlg').getBoundingClientRect(); return { l: d.left, r: d.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
    ok(fit.l >= 0 && fit.r <= fit.w && fit.sw <= fit.w, 'C1 the report fits a phone ' + JSON.stringify(fit));
    await page.screenshot({ path: dir + 'vc/report-phone.png' });
    ok(errs.length === 0, 'C2 no page errors ' + JSON.stringify(errs));
  }
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
