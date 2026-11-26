import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {listPaidPurchases,accountOverview,assignKey,readCustomerKey,encryptCustomerKey,
 decryptCustomerKey,validUploadedExe,storeRelease,addStockKey,queuePaidKey,stockOverview,ownerStockPath,revealStockKey,importStockKeys} from '../lib/fulfillment.mjs';
import {handleInteraction} from '../lib/discord.mjs';
import {readFileSync} from 'node:fs';

const buyer='1574096900000000001';
const owner='1574096900000000002';
const guild='1448897452404117558';
const channel='1574104734124605460';
const prefix='private/discord-entitlements/'+buyer+'/';
const payment='pay_ABCDEF123456';
const future=new Date(Date.now()+86400000).toISOString();
const ledger=()=>({[prefix+payment]:{paymentId:payment,planId:'day',expiresAt:future}});
const bucket=(data={})=>({
  data,versions:{},
  async list({prefix}){
    return {objects:Object.keys(this.data).filter(x=>x.startsWith(prefix)).map(key=>({key})),truncated:false,cursor:null};
  },
  async head(key){return this.data[key]?{pathname:key}:null;},
  async get(key){return this.data[key]?{etag:String(this.versions[key]||0),json:async()=>structuredClone(this.data[key])}:null;},
  async put(key,value,options){
    if(options?.onlyIf?.etagDoesNotMatch==='*'&&this.data[key])return null;
    if(options?.onlyIf?.etagMatches!==undefined&&String(this.versions[key]||0)!==options.onlyIf.etagMatches)return null;
    this.versions[key]=(this.versions[key]||0)+1;this.data[key]=JSON.parse(value);return {etag:String(this.versions[key])};
  }
});
test('no purchase exposes neither download nor license',async()=>{
 const account=await accountOverview(bucket(),{discordId:buyer});
 assert.equal(account.active,false);
 assert.equal(account.downloadAvailable,false);
 assert.equal(account.keyAvailable,false);
 assert.equal(account.purchases.length,0);
});
test('verified paid purchase is shown while missing key stays hidden',async()=>{
 const account=await accountOverview(bucket(ledger()),{discordId:buyer});
 assert.equal(account.active,true);
 assert.equal(account.keyAvailable,false);
 assert.equal(account.downloadAvailable,false);
 assert.equal(account.purchases[0].paymentId,payment);
});
test('license keys are encrypted, scoped to paid Discord identity and cannot be overwritten',async()=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY;
 process.env.BRO_KEY_ENCRYPTION_KEY='a'.repeat(64);
 try {
   const store=bucket(ledger());
   assert.deepEqual(await assignKey(store,{discordId:'1574096999999999999',key:'TEST-KEY-999',operatorId:owner}),{status:'no_purchase'});
   assert.deepEqual(await assignKey(store,{discordId:buyer,key:'TEST-KEY-999',operatorId:owner}),{status:'assigned'});
   const encrypted=store.data['private/licenses/inventory-v1.json'];
   assert.equal(JSON.stringify(encrypted).includes('TEST-KEY-999'),false);
   assert.equal(await readCustomerKey(store,buyer),'TEST-KEY-999');
   assert.deepEqual(await assignKey(store,{discordId:buyer,key:'ANOTHER-KEY',operatorId:owner}),{status:'already_assigned'});
   assert.equal(decryptCustomerKey(encryptCustomerKey('TEST-KEY-999')),'TEST-KEY-999');
 } finally {if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;}
});
test('unknown and broken executables are never accepted',()=>{
 assert.equal(validUploadedExe(Buffer.from('MZ')),false);
 assert.equal(validUploadedExe(Buffer.alloc(2836992)),false);
});
test('portal contains only authenticated delivery endpoints and a real refresh action',()=>{
 const site=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.ok(site.includes('/api/account/overview'));
 assert.ok(!site.includes('/api/account/download'));
 assert.ok(!site.includes('/api/admin/release'));
 const api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(api,/res\.status\(410\)/);
 assert.ok(site.includes('/api/account/key.txt'));
 assert.ok(site.includes('Actualiser mes achats'));
 assert.ok(site.includes('discordMark'));
});
test('signed /startkey is restricted to both the owner and staff channel',async t=>{
 const old={owner:process.env.BRO_DISCORD_OWNER_USER_ID, guild:process.env.BRO_DISCORD_GUILD_ID,
  pub:process.env.BRO_DISCORD_PUBLIC_KEY,secret:process.env.BRO_KEY_ENCRYPTION_KEY};
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const rawPublic=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 Object.assign(process.env,{BRO_DISCORD_OWNER_USER_ID:owner,BRO_DISCORD_GUILD_ID:guild,
  BRO_DISCORD_PUBLIC_KEY:rawPublic,BRO_KEY_ENCRYPTION_KEY:'a'.repeat(64)});
 t.after(()=>{
  const vars={BRO_DISCORD_OWNER_USER_ID:old.owner,BRO_DISCORD_GUILD_ID:old.guild,
   BRO_DISCORD_PUBLIC_KEY:old.pub,BRO_KEY_ENCRYPTION_KEY:old.secret};
  for(const [key,value] of Object.entries(vars)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 });
 const store=bucket(ledger());
 const payload=(who,where)=>({type:2,guild_id:guild,channel_id:where,member:{user:{id:who}},
  data:{name:'startkey',options:[{name:'acheteur',value:buyer},{name:'cle',value:'TEST-KEY-123'}]}});
 async function dispatch(event){
  const raw=Buffer.from(JSON.stringify(event));
  const time=String(Math.floor(Date.now()/1000));
  const sig=sign(null,Buffer.concat([Buffer.from(time),raw]),privateKey).toString('hex');
  const req={headers:{'x-signature-timestamp':time,'x-signature-ed25519':sig}};
  const res={code:200,status(n){this.code=n;return this;},json(body){return {status:this.code,body};},end(){return {status:this.code};}};
  return handleInteraction(req,res,raw,store);
 }
 const rogue=await dispatch(payload(buyer,channel));
 assert.match(rogue.body.data.content,/réservée/);
 const outside=await dispatch(payload(owner,'1574104734124605499'));
 assert.match(outside.body.data.content,/réservée/);
 const approved=await dispatch(payload(owner,channel));
 assert.match(approved.body.data.content,/attribuée/);
 assert.equal(await readCustomerKey(store,buyer),'TEST-KEY-123');
});

test('discontinued launcher cannot be offered or republished even with an existing file',async()=>{
 const b=bucket({...ledger(),'private/releases/BroClient.exe':{old:true}});
 assert.equal((await accountOverview(b,{discordId:buyer})).downloadAvailable,false);
 assert.deepEqual(await storeRelease(b,Buffer.alloc(0)),{status:'distribution_discontinued'});
});

test('stock is encrypted, deduplicated and allocated at most once per verified payment',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY;process.env.BRO_KEY_ENCRYPTION_KEY='b'.repeat(64);t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;});
 const admin='1027596385123565569', other='1574096900000000003',second='pay_SECOND123';
 const store=bucket({...ledger(),['private/discord-entitlements/'+other+'/'+second]:{paymentId:second,planId:'day',expiresAt:future}});
 assert.equal(ownerStockPath({discordId:other,admin:true}),null);assert.match(ownerStockPath({discordId:admin}),/^\/gestion-cles\/[a-f0-9]{64}$/);
 assert.equal((await addStockKey(store,{planId:'day',key:'TEST-STOCK-001',operatorId:other})).status,'invalid');
 assert.equal((await addStockKey(store,{planId:'day',key:'TEST-STOCK-001',operatorId:admin})).status,'added');
 assert.equal((await addStockKey(store,{planId:'week',key:'TEST-STOCK-001',operatorId:admin})).status,'duplicate');
 const orders=[{discordId:buyer,paymentId:payment,planId:'day',expiresAt:future},{discordId:other,paymentId:second,planId:'day',expiresAt:future}];
 const results=await Promise.all(orders.map(order=>queuePaidKey(store,order)));
 assert.deepEqual(results.map(x=>x.status).sort(),['assigned','waiting_stock']);
 assert.equal((await stockOverview(store)).counts.day.available,0);
 assert.equal((await stockOverview(store)).counts.day.assigned,1);
 assert.equal((await addStockKey(store,{planId:'day',key:'TEST-STOCK-002',operatorId:admin})).assigned,true);
 const keys=await Promise.all(orders.map(o=>readCustomerKey(store,o.discordId,o.paymentId)));assert.equal(new Set(keys).size,2);
 assert.equal(await readCustomerKey(store,other,payment),null);
 assert.equal((await queuePaidKey(store,orders[0])).status,'assigned');
 assert.equal((await stockOverview(store)).counts.day.assigned,2);
 assert.ok(!JSON.stringify(store.data).includes('TEST-STOCK-001'));
 assert.equal((await queuePaidKey(store,{...orders[0],paymentId:'pay_FAKE123'})).status,'unverified');
});

test('legacy keys are reserved against duplicate stock and not exposed to other buyers',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY;process.env.BRO_KEY_ENCRYPTION_KEY='c'.repeat(64);t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;});
 const store=bucket({...ledger(),['private/customer-keys/'+buyer+'.json']:{...encryptCustomerKey('TEST-LEGACY-KEY'),assignedAt:new Date().toISOString()}});
 assert.equal((await addStockKey(store,{planId:'week',key:'TEST-LEGACY-KEY',operatorId:'1027596385123565569'})).status,'duplicate');
 assert.equal(await readCustomerKey(store,buyer,'legacy'),'TEST-LEGACY-KEY');
 assert.equal(await readCustomerKey(store,'1574096900000000004','legacy'),null);
});
test('owner-only stock reveal returns exactly the selected key, never another user’s secret',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY;process.env.BRO_KEY_ENCRYPTION_KEY='d'.repeat(64);t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;});
 const admin='1027596385123565569',store=bucket();const added=await addStockKey(store,{planId:'week',key:'TEST-REVEAL-01',operatorId:admin});
 assert.equal(added.status,'added');const view=await stockOverview(store);assert.equal(view.rows[0].id,added.id);assert.ok(!JSON.stringify(view).includes('TEST-REVEAL-01'));
 assert.equal(await revealStockKey(store,{discordId:admin},added.id),'TEST-REVEAL-01');assert.equal(await revealStockKey(store,{discordId:buyer,admin:true},added.id),null);assert.equal(await revealStockKey(store,null,added.id),null);
 const ui=readFileSync(new URL('../key-stock.js',import.meta.url),'utf8');assert.match(ui,/\/api\/admin\/key-stock/);assert.match(ui,/aria-busy/);
});
test('bulk import locks sold duplicates and unknown statuses, preserves category and is idempotent',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY;process.env.BRO_KEY_ENCRYPTION_KEY='e'.repeat(64);t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;});
 const admin='1027596385123565569',store=bucket(ledger());
 const rows=[{key:'TEST-DUPLICATE',status:'available'},{key:'TEST-DUPLICATE',status:'sold'},{key:'TEST-UNKNOWN',status:'quarantine'},{key:'TEST-FREE',status:'available'}];
 assert.equal((await importStockKeys(store,{planId:'day',rows,operatorId:buyer})).status,'invalid');
 const result=await importStockKeys(store,{planId:'day',rows,operatorId:admin});
 assert.equal(result.added,3);assert.equal(result.duplicates,1);
 assert.equal((await importStockKeys(store,{planId:'day',rows,operatorId:admin})).added,0);
 assert.equal((await queuePaidKey(store,{discordId:buyer,paymentId:payment,planId:'day',expiresAt:future})).status,'assigned');
 assert.equal(await readCustomerKey(store,buyer,payment),'TEST-FREE');
 const overview=await stockOverview(store);assert.equal(overview.rows.filter(r=>r.status==='sold').length,1);assert.equal(overview.rows.filter(r=>r.status==='quarantine').length,1);assert.equal(overview.counts.day.available,0);
 assert.ok(!JSON.stringify(store.data).includes('TEST-DUPLICATE'));
});
test('workbook import validates all categories in one commit and blocks conflicting licences before allocation',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY;process.env.BRO_KEY_ENCRYPTION_KEY='b'.repeat(64);t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;});
 const store=bucket(ledger()),admin='1027596385123565569';
 const rows=[{planId:'day',key:'TEST-CROSS-PLAN',status:'available'},{planId:'week',key:'TEST-CROSS-PLAN',status:'available'},{planId:'day',key:'TEST-DAY-FREE',status:'available'},{planId:'month',key:'TEST-MONTH-SOLD',status:'sold'}];
 assert.equal((await importStockKeys(store,{planId:null,rows,operatorId:admin})).conflicts,1);
 assert.equal((await queuePaidKey(store,{discordId:buyer,paymentId:payment,planId:'day',expiresAt:future})).status,'assigned');
 assert.equal(await readCustomerKey(store,buyer,payment),'TEST-DAY-FREE');
 const view=await stockOverview(store);assert.equal(view.rows.filter(r=>r.status==='quarantine').length,1);assert.equal(view.rows.filter(r=>r.status==='sold').length,1);
});

import {canReadCustomerGuides,readCustomerGuideCatalog,renderCustomerGuides,customerGuideIndex,selectCustomerGuide} from '../lib/customer-guides.mjs';
test('only verified buyers can read the new customer documentation, including former buyers',async()=>{
 assert.equal(await canReadCustomerGuides(bucket(ledger()),null),false);
 assert.equal(await canReadCustomerGuides(bucket(),{discordId:buyer}),false);
 assert.equal(await canReadCustomerGuides(bucket(ledger()),{discordId:buyer}),true);
 assert.equal(await canReadCustomerGuides(bucket(ledger()),{discordId:owner}),false);
 const expired=ledger();expired[prefix+payment].expiresAt='2020-01-01T00:00:00Z';
 assert.equal(await canReadCustomerGuides(bucket(expired),{discordId:buyer}),true);
 const catalog=await readCustomerGuideCatalog(bucket({'guides/catalogue.json':[{title:'OLD-ARCHIVE',body:'OLD-ARCHIVE'}]}));
 assert.equal(catalog.guides.length,3);assert.doesNotMatch(renderCustomerGuides(catalog.guides),/OLD-ARCHIVE|StratX/);
 assert.doesNotMatch(renderCustomerGuides(),/Préparer une demande d’assistance/);
 assert.match(renderCustomerGuides([{title:'<script>',body:'test'}]),/&lt;script&gt;/);
 const build=readFileSync(new URL('../build.mjs',import.meta.url),'utf8');assert.doesNotMatch(build,/await buildGuides/);
 const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.ok(config.rewrites.filter(x=>x.source.startsWith('/guides')).every(x=>x.destination.startsWith('/api/platform?route=')));
 for(const p of ['index.html','offres.html','patchnotes.html'])assert.match(readFileSync(new URL('../'+p,import.meta.url),'utf8'),/data-paid-guides hidden/);
});

test('paused automatic license allocation preserves stock, verified pending orders and existing keys',async t=>{
 const saved=process.env.BRO_KEY_DELIVERY_PAUSED, enc=process.env.BRO_KEY_ENCRYPTION_KEY;
 t.after(()=>{if(saved===undefined)delete process.env.BRO_KEY_DELIVERY_PAUSED;else process.env.BRO_KEY_DELIVERY_PAUSED=saved;if(enc===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=enc;});
 process.env.BRO_KEY_ENCRYPTION_KEY='d'.repeat(64);
 const admin='1027596385123565569',other='1574096900000000003',second='pay_SECOND123';
 const store=bucket({...ledger(),['private/discord-entitlements/'+other+'/'+second]:{paymentId:second,planId:'day',expiresAt:future}});
 process.env.BRO_KEY_DELIVERY_PAUSED='false';
 await addStockKey(store,{planId:'day',key:'TEST-EXISTING-001',operatorId:admin});
 assert.equal((await queuePaidKey(store,{discordId:buyer,paymentId:payment,planId:'day',expiresAt:future})).status,'assigned');
 process.env.BRO_KEY_DELIVERY_PAUSED='true';
 await addStockKey(store,{planId:'day',key:'TEST-PAUSED-002',operatorId:admin});
 const order={discordId:other,paymentId:second,planId:'day',expiresAt:future};
 assert.equal((await queuePaidKey(store,order)).status,'waiting_stock');
 assert.equal((await addStockKey(store,{planId:'day',key:'TEST-PAUSED-003',operatorId:admin})).assigned,false);
 assert.equal((await stockOverview(store)).counts.day.available,2);
 assert.equal((await stockOverview(store)).counts.day.waiting,1);
 assert.equal(await readCustomerKey(store,buyer,payment),'TEST-EXISTING-001');
 assert.equal(await readCustomerKey(store,other,second),null);
 process.env.BRO_KEY_DELIVERY_PAUSED='false';
 assert.equal((await queuePaidKey(store,order)).status,'assigned');
 assert.ok(await readCustomerKey(store,other,second));
});

test('automatic replenishment serves already-paid waiting orders for matching passes, once each',async t=>{
 const enc=process.env.BRO_KEY_ENCRYPTION_KEY,pause=process.env.BRO_KEY_DELIVERY_PAUSED;
 t.after(()=>{if(enc===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=enc;if(pause===undefined)delete process.env.BRO_KEY_DELIVERY_PAUSED;else process.env.BRO_KEY_DELIVERY_PAUSED=pause;});
 process.env.BRO_KEY_ENCRYPTION_KEY='f'.repeat(64);process.env.BRO_KEY_DELIVERY_PAUSED='false';
 const admin='1027596385123565569',other='1574096900000000003',second='pay_RESTOCK123';
 const store=bucket({...ledger(),['private/discord-entitlements/'+other+'/'+second]:{paymentId:second,planId:'day',expiresAt:future}});
 const one={discordId:buyer,paymentId:payment,planId:'day',expiresAt:future},two={discordId:other,paymentId:second,planId:'day',expiresAt:future};
 assert.equal((await queuePaidKey(store,one)).status,'waiting_stock');
 assert.equal((await queuePaidKey(store,two)).status,'waiting_stock');
 await addStockKey(store,{planId:'week',key:'TEST-WEEK-RESTOCK',operatorId:admin});
 assert.equal((await stockOverview(store)).counts.day.waiting,2);
 await importStockKeys(store,{planId:'day',rows:[{key:'TEST-LOCKED-RESTOCK',status:'sold'},{key:'TEST-VALID-RESTOCK-1',status:'available'},{key:'TEST-VALID-RESTOCK-2',status:'available'}],operatorId:admin});
 assert.equal(await readCustomerKey(store,buyer,payment),'TEST-VALID-RESTOCK-1');
 assert.equal(await readCustomerKey(store,other,second),'TEST-VALID-RESTOCK-2');
 const overview=await stockOverview(store);
 assert.equal(overview.counts.day.waiting,0);assert.equal(overview.counts.day.available,0);
 assert.equal(overview.rows.filter(r=>r.planId==='day'&&r.status==='assigned').length,2);
 assert.equal(overview.counts.week.available,1);
 assert.equal((await queuePaidKey(store,one)).status,'assigned');
 assert.equal((await addStockKey(store,{planId:'day',key:'TEST-VALID-RESTOCK-1',operatorId:admin})).status,'duplicate');
 const ui=readFileSync(new URL('../key-stock.js',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/Attribuer une clé|endpoint\+'\/assign'/);assert.doesNotMatch(api,/\/api\/admin\/key-stock\/assign/);
});

test('guide index exposes titles only and resolves the exact guide without exposing a different body',async()=>{
 const {guides}=await readCustomerGuideCatalog(bucket());
 const index=customerGuideIndex(guides);assert.equal(index.length,guides.length);
 assert.ok(index.every(g=>Object.keys(g).sort().join(',')==='id,title'));
 assert.equal(selectCustomerGuide(guides,index[1].id),guides[1]);
 assert.equal(selectCustomerGuide(guides,'bad'),null);
 const html=renderCustomerGuides([selectCustomerGuide(guides,index[1].id)]);
 assert.match(html,/Accès et configuration/);assert.doesNotMatch(html,/Préparer une demande d’assistance/);
 assert.match(html,/\/espace-client\?tab=guides/);
 const api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(api,/if\(parsed.searchParams.get\('view'\)==='index'\)\{\s*if\(!await canReadCustomerGuides\(bucket,user\)\)/);
});

test('account purchase dates use owned verified records, never expiry or another account',async()=>{
 const ownerId='auth-a',otherId='auth-b',older='pay_OLD',newer='pay_NEW',unknown='pay_UNKNOWN';
 const ownerPrefix='private/invoices/'+createHash('sha256').update(ownerId).digest('hex')+'/';
 const otherPrefix='private/invoices/'+createHash('sha256').update(otherId).digest('hex')+'/';
 const store=bucket({
 [prefix+older]:{paymentId:older,planId:'life',expiresAt:null},
 [prefix+newer]:{paymentId:newer,planId:'day',expiresAt:future},
 [prefix+unknown]:{paymentId:unknown,planId:'week',expiresAt:future},
 [ownerPrefix+older]:{id:older,date:'2026-11-20T12:00:00Z'},
 ['private/activity/receipts/'+newer+'.json']:{paymentId:newer,discordId:buyer,planId:'day',date:'2026-11-25T12:00:00Z'},
 [otherPrefix+unknown]:{id:unknown,date:'2026-11-26T12:00:00Z'},
 ['private/activity/receipts/'+unknown+'.json']:{paymentId:unknown,discordId:owner,planId:'week',date:'2026-11-26T12:00:00Z'}
 });
 const overview=await accountOverview(store,{id:ownerId,discordId:buyer});
 assert.deepEqual(overview.purchases.map(p=>[p.paymentId,p.purchaseDate]),[[newer,'2026-11-25T12:00:00.000Z'],[older,'2026-11-20T12:00:00.000Z'],[unknown,null]]);
});

test('private stock manager uses distinct local views without changing owner checks or delivery routes',()=>{
 const ui=readFileSync(new URL('../key-stock.js',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../key-stock.css',import.meta.url),'utf8');
 assert.match(api,/if\(!privatePath\|\|!\(path===privatePath\|\|path===privatePath\+'\/stock'\)\)return res.status\(404\)/);
 assert.match(api,/if\(!ownerStockPath\(user\)\)return res.status\(404\)/);
 for(const id of ['supply-view','pending-view','inventory-view','inventory-filters','view-all'])assert.ok(api.includes(id));
 const start=ui.indexOf('function viewState('),end=ui.indexOf('function selectPlan(',start);
 const view=Function(ui.slice(start,end)+';return viewState;')();
 assert.deepEqual(view('all'),{category:false,summary:true,supply:false,pending:true,inventory:true,preview:true});
 assert.deepEqual(view('week'),{category:true,summary:true,supply:false,pending:false,inventory:true,preview:false});
 assert.equal(view('supply').inventory,false);assert.equal(view('supply').supply,true);
 assert.equal(view('pending').pending,true);assert.equal(view('pending').inventory,false);
 assert.equal(view('legacy').summary,false);assert.equal(view('legacy').inventory,true);
 const selection=ui.slice(ui.indexOf('function selectPlan('),ui.indexOf('function render()'));
 assert.doesNotMatch(selection,/fetch\(|request\(|\bload\(/);
 assert.match(ui,/if\(!v.inventory\)return/);assert.match(css,/\[hidden\]\{display:none!important\}/);
 assert.match(ui,/pagehide/);assert.match(ui,/if\(v.preview&&pending.length>5\)/);
});
