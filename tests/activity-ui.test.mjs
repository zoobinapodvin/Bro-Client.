import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 normalizePayment,storeActivity,recentPurchases,setActivityPreference,getActivityPreference,
 backfillWhopHistory
} from '../lib/activity.mjs';

process.env.WHOP_ACCOUNT_ID='biz_emxZArodB6p2Af';
const discordId='1574096900000000001';
const payment=(id,date,productId='prod_ZrNuFIODHTxMx')=>({
 id,paid_at:date,status:'paid',account_id:'biz_emxZArodB6p2Af',
 product:{id:productId},amount_charged:{amount:6,currency:'EUR'}
});
const bucket=()=>({
 objects:{},
 async list({prefix}){return {objects:Object.keys(this.objects).filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false,cursor:null};},
 async get(key){return this.objects[key]?{json:async()=>this.objects[key]}:null;},
 async head(key){return this.objects[key]?{etag:'exists'}:null;},
 async put(key,payload,options){if(options?.onlyIf?.etagDoesNotMatch==='*'&&this.objects[key])return null;
   this.objects[key]=JSON.parse(payload);return {etag:'ok'};}
});
test('public activity accepts only verified company, known plan, date and currency',()=>{
 const p=payment('pay_TEST1','2026-11-22T12:00:00.000Z');
 const result=normalizePayment(p,'day');
 assert.equal(result.name,'Client BRO');
 assert.equal(result.avatar,null);
 assert.equal(result.amount,6);
 assert.equal(normalizePayment({...p,account_id:'biz_wrong'},'day'),null);
 assert.equal(normalizePayment({...p,status:'failed',account_id:'biz_wrong'},'day'),null);
 assert.equal(normalizePayment({...p,amount_charged:{amount:6,currency:'USD'}},'day'),null);
});
test('public Discord username only appears with opt-in and never accepts email or untrusted avatar',()=>{
 const p=payment('pay_TEST2','2026-11-22T12:00:00.000Z');
 const a=normalizePayment(p,'day',{visible:true,username:'person@site.com',avatar:'https://evil.invalid/avatar.jpg'});
 assert.equal(a.name,'Client BRO');
 assert.equal(a.avatar,null);
 const b=normalizePayment(p,'day',{visible:true,username:'BroUser',avatar:'https://cdn.discordapp.com/avatars/123/abc.png?size=128'});
 assert.equal(b.name,'BroUser');
 assert.match(b.avatar,/cdn.discordapp.com/);
});
test('newest 5 verified payments are returned without payment IDs, with correct order',async()=>{
 const b=bucket();
 for(let i=0;i<7;i++){
  const id='pay_TEST'+i;
  const p=payment(id,new Date(Date.UTC(2026,10,22,10,i)).toISOString());
  await storeActivity(b,normalizePayment(p,'day'));
 }
 assert.equal((await recentPurchases(b)).length,5);
 const first=(await recentPurchases(b))[0];
 assert.equal(first.date,'2026-11-22T10:06:00.000Z');
 assert.equal(Object.keys(first).includes('paymentId'),false);
});
test('user may revoke Discord pseudo on existing public transactions',async()=>{
 const b=bucket();
 const p=payment('pay_OPTOUT','2026-11-22T12:00:00.000Z');
 await storeActivity(b,{...normalizePayment(p,'day',{visible:true,username:'BroDev',avatar:null}),discordId});
 await setActivityPreference(b,{discordId},true);
 assert.equal(await getActivityPreference(b,discordId),true);
 await setActivityPreference(b,{discordId},false);
 assert.equal(await getActivityPreference(b,discordId),false);
 const feed=await recentPurchases(b);
 assert.equal(feed[0].name,'Client BRO');
 assert.equal(feed[0].avatar,null);
});
test('historical import is scoped to paid exact products, does not grant licenses and is idempotent',async t=>{
 const orig=globalThis.fetch;
 t.after(()=>{globalThis.fetch=orig});
 const b=bucket();
 const valid=payment('pay_HIST1','2026-11-22T11:00:00.000Z');
 const invalid=payment('pay_HIST2','2026-11-22T10:00:00.000Z','prod_other');
 let calls=0;
 globalThis.fetch=async(url,opts)=>{
   calls++;
   const parsed=new URL(url);
   assert.equal(parsed.searchParams.get('company_id'),'biz_emxZArodB6p2Af');
   assert.equal(opts.headers.Authorization,'Bearer secret-test');
   return Response.json({data:[valid,invalid],page_info:{has_next_page:false}});
 };
 const params={apiKey:'secret-test',accountId:'biz_emxZArodB6p2Af'};
 const first=await backfillWhopHistory(b,params);
 assert.equal(first.imported,1);
 const second=await backfillWhopHistory(b,params);
 assert.equal(second.imported,0);
 assert.equal(calls,2);
 assert.equal(Object.keys(b.objects).some(key=>key.startsWith('private/discord-entitlements')),false);
});
test('public site contains accessible five-purchase board; account has no e-mail field and licenses are displayed only per verified purchase',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(html,/id="purchaseBoard"/);
 assert.match(js,/refreshRecentBoard/);
 assert.match(js,/user\.discordUsername/);
 assert.doesNotMatch(js,/user\.email/);
 assert.doesNotMatch(api,/email:user\.email/);
 assert.doesNotMatch(js,/Synchronisation automatique Whop en attente de configuration/);
 assert.match(css,/#modal\.client-portal-compact/);
 assert.match(css,/overflow:hidden!important/);
 assert.match(js,/if\(purchase\.keyAvailable\)/);
 assert.match(js,/encodeURIComponent\(purchase\.paymentId\)/);
});

test('a verified order can upgrade a pre-imported anonymous purchase without changing its payment',async()=>{
 const b=bucket();
 const p=payment('pay_LINKED','2026-11-22T13:00:00.000Z');
 await storeActivity(b,normalizePayment(p,'day'));
 const linked={...normalizePayment(p,'day'),discordId};
 const outcome=await storeActivity(b,linked);
 assert.equal(outcome.updated,true);
 const record=b.objects['private/activity/receipts/pay_LINKED.json'];
 assert.equal(record.discordId,discordId);
 assert.equal(record.name,'Client BRO');
 assert.equal((await recentPurchases(b))[0].discordId,undefined);
 // An unrelated account may not overwrite this private verified binding.
 await storeActivity(b,{...normalizePayment(p,'day',{visible:true,username:'Imposter'}),discordId:'1574096900000000002'});
 assert.equal(b.objects['private/activity/receipts/pay_LINKED.json'].discordId,discordId);
});
test('authenticated opt-in exposes only the verified owner Discord avatar and supports revocation',async()=>{
 const b=bucket();
 const p=payment('pay_VISIBLE','2026-11-22T13:00:00.000Z');
 await storeActivity(b,{...normalizePayment(p,'day'),discordId});
 const unrelated=payment('pay_PRIVATE','2026-11-22T12:00:00.000Z');
 await storeActivity(b,normalizePayment(unrelated,'day'));
 const user={discordId,discordUsername:'BroVerified',discordAvatar:'https://cdn.discordapp.com/avatars/1574096900000000001/hashaabb.png'};
 await setActivityPreference(b,user,true);
 let result=await recentPurchases(b);
 assert.equal(result[0].name,'BroVerified');
 assert.match(result[0].avatar,/cdn\.discordapp\.com/);
 assert.equal(result[1].name,'Client BRO');
 await setActivityPreference(b,user,false);
 result=await recentPurchases(b);
 assert.equal(result[0].name,'Client BRO');
 assert.equal(result[0].avatar,null);
 assert.equal(b.objects['private/activity/receipts/pay_VISIBLE.json'].discordId,discordId);
});
test('new purchase card interface remains accessible and adaptive on mobile',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 assert.match(html,/class="purchase-board-list"[^>]*aria-live="polite"/);
 assert.match(html,/class="mobile-dock"/);
 assert.match(html,/data-account/);
 assert.match(js,/purchase-card-buyer/);
 assert.match(js,/purchase-card-avatar/);
 assert.match(js,/profileVisibilitySetting/);
 assert.match(js,/setInterval\(\(\)=>\{if\(document.visibilityState==='visible'\)refreshRecentBoard\(\);\},15000\)/);
 assert.match(css,/\.purchase-card\{/);
 assert.match(css,/@media\(max-width:680px\)/);
});

test('public Discord display strips legacy discriminator without exposing addresses',()=>{
 const p=payment('pay_DISCRIMINATOR','2026-11-23T02:00:00.000Z');
 const publicRecord=normalizePayment(p,'day',{visible:true,username:'n7umber#0',avatar:'https://cdn.discordapp.com/avatars/1574096900000000001/test.png'});
 assert.equal(publicRecord.name,'n7umber');
 assert.ok(publicRecord.avatar?.startsWith('https://cdn.discordapp.com/avatars/'));
 assert.equal(normalizePayment(p,'day',{visible:false,username:'n7umber#0'}).name,'Client BRO');
 assert.equal(normalizePayment(p,'day',{visible:true,username:'user@example.com'}).name,'Client BRO');
});
test('homepage has a discreet, compact animated feed without repeated sales copy',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 assert.doesNotMatch(html,/Les 5 dernières commandes BRO CLIENT, vérifiées par Whop/);
 assert.doesNotMatch(html,/class="purchase-board-foot"/);
 assert.match(css,/width:min\(800px,89%\)/);
 assert.match(css,/purchase-metal-sheen/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(js,/purchase\.name\.replace\(\/#\\d\{1,4\}\$\//);
 assert.match(js,/purchase-card-new/);
});



test('obsolete homepage preview is removed and legal navigation remains available',()=>{
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const legal=readFileSync(new URL('../informations.html',import.meta.url),'utf8');
 assert.doesNotMatch(home,/id="apercus"|Explorer l’interface|full-launcher/);
 assert.doesNotMatch(js,/const gallery=\$/);
 assert.match(home,/href="\/informations\.html"/);
 assert.match(legal,/Discord est obligatoire/);
});


test('recent feed uses the private index after initial backfill and keeps new receipts current',async()=>{const b=bucket();await storeActivity(b,normalizePayment(payment('pay_INDEX1','2026-11-22T12:00:00Z'),'day'));await recentPurchases(b);const original=b.list;b.list=async()=>{throw Error('full scan should not run');};await storeActivity(b,normalizePayment(payment('pay_INDEX2','2026-11-22T13:00:00Z'),'day'));assert.equal((await recentPurchases(b))[0].date,'2026-11-22T13:00:00.000Z');b.list=original;});
test('pass buttons use internal checkout routes and account overview is preloaded without persistent private data',()=>{for(const p of ['index.html','offres.html','patchnotes.html','informations.html'])assert.doesNotMatch(readFileSync(new URL('../'+p,import.meta.url),'utf8'),/https:\/\/discord\.gg\//);const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');assert.ok(js.includes("cta=link(c.planButton,'/checkout/'+plan.id,'btn plan-button')"));assert.deepEqual([...js.matchAll(/https:\/\/discord\.gg\/[A-Za-z0-9]+/g)],[]);assert.match(js,/preloadedOverview/);assert.doesNotMatch(js,/sessionStorage\.setItem\([^\n]*overview/i);});
test('announced product scope and legal navigation remain available',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');for(const label of ['Compteur de FPS','Clavier et souris','Widgets de bureau','Personnalisation d’interface','Options cosmétiques autorisées','Profils de configuration'])assert.ok(html.includes(label));assert.match(html,/href="\/informations\.html"/);});


// Check the substantive pre-purchase information without freezing its editorial wording.
// These assertions are not a product compliance audit.
test('product scope, historical risks and verification status remain visible before purchase',()=>{
 const offers=readFileSync(new URL('../offres.html',import.meta.url),'utf8');
 // The purchase page retains the detailed disclosure; the homepage need not duplicate it.
 for(const html of [offers]){
  const paragraphs=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
  const notice=paragraphs.find(p=>/(?:visée|vis[eé]e assistée|aide à la visée|aimbot)/i.test(p)&&/(?:inaccessible|non accessible|non autoris|réservées)/i.test(p)&&/(?:sanction|bannissement|suspension)/i.test(p)&&/(?:licences|accès existants)/i.test(p)&&/(?:non vérifi|pas été vérifi|pas encore vérifi|reste à vérifi|non audit|pas été audit|pas confirm|reste à confirm|non confirm)/i.test(p));
  assert.ok(notice,'Information produit et risques avant achat');
 }
});

import {canEditHomepage,readHomepage,saveHomepage,validHomePatch,HOME_FIELDS} from '../lib/homepage.mjs';
test('inline homepage publishes only owner changes with revision locking and no checkout or disclosure edits',async()=>{
 const records=new Map();let version=0;const b={get:async k=>records.has(k)?{etag:records.get(k).etag,json:async()=>structuredClone(records.get(k).value)}:null,put:async(k,v,o)=>{const old=records.get(k);if(o.onlyIf?.etagDoesNotMatch==='*'&&old||o.onlyIf?.etagMatches&&old?.etag!==o.onlyIf.etagMatches)return null;const etag=String(++version);records.set(k,{etag,value:JSON.parse(v)});return {etag};}};
 const owner={discordId:'1027596385123565569'},other={discordId:'1574096900000000001',admin:true};
 assert.equal(canEditHomepage(other),false);assert.equal((await saveHomepage(b,other,'initial',{id:'hero',fields:{text:'Test'}})).status,403);
 assert.equal(validHomePatch('hero',{checkoutUrl:'https://example.org'}),false);assert.equal(validHomePatch('product-transparency',{text:'Test'}),false);assert.equal(validHomePatch('access-1',{image:'javascript:alert(1)'}),false);
 const first=await saveHomepage(b,owner,'initial',{id:'hero',fields:{text:'Test'}});assert.equal(first.status,200);const rev=(await first.json()).revision;
 assert.equal((await saveHomepage(b,owner,'initial',{id:'access-1',fields:{title:'Autre'}})).status,409);
 const second=await saveHomepage(b,owner,rev,{id:'access-1',fields:{title:'Autre',image:'/assets/test.webp'}});assert.equal(second.status,200);
 const data=await readHomepage(b);assert.equal(data.blocks.hero.text,'Test');assert.equal(data.blocks['access-1'].image,'/assets/test.webp');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),js=readFileSync(new URL('../homepage-editor.js',import.meta.url),'utf8');assert.ok(Object.keys(HOME_FIELDS).length>=20);assert.match(html,/homepage-editor.js/);assert.match(js,/setInterval\(check,5000\)/);assert.match(js,/location.reload\(\)/);assert.doesNotMatch(html,/data-home-block="product-transparency"/);
});
test('offers inline editor isolates each card and preserves protected checkout and disclosure fields',()=>{
 const html=readFileSync(new URL('../offres.html',import.meta.url),'utf8'),app=readFileSync(new URL('../app.js',import.meta.url),'utf8'),js=readFileSync(new URL('../homepage-editor.js',import.meta.url),'utf8'),css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 for(const id of ['day','week','month','life']){assert.deepEqual(HOME_FIELDS['offer-plan-'+id],['title','text','cta','image']);assert.equal(validHomePatch('offer-plan-'+id,{price:'1'}),false);assert.equal(validHomePatch('offer-plan-'+id,{duration:'forever'}),false);assert.equal(validHomePatch('offer-plan-'+id,{checkoutUrl:'https://example.com'}),false);assert.equal(validHomePatch('offer-plan-'+id,{image:''}),true);}
 assert.match(html,/homepage-editor.js/);assert.match(app,/card.dataset.homeBlock='offer-plan-'\+plan.id/);assert.match(js,/--offer-custom-art/);assert.match(css,/data-offer-artwork=custom/);assert.doesNotMatch(html,/data-home-block="(?:capability-disclaimer|purchase-guide-warning)"/);assert.match(html,/href="\/informations\.html"/);
});

test('compatibility block attributes installation and Windows compatibility claims to publisher testing',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/id="broCompatibilityTitle"/);assert.match(html,/Windows 10 &amp; 11/);assert.match(html,/Windows 10 \(32 et 64 bits\) et Windows 11 \(64 bits\)/);assert.match(readFileSync(new URL('../offres.html',import.meta.url),'utf8'),/Windows 10 \(32 et 64 bits\) et Windows 11 \(64 bits\)/);assert.match(html,/Installation en un clic/);assert.match(html,/selon les tests de l’éditeur/);});

test('all homepage editorial cards including compatibility and setup have valid owner editing fields',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),js=readFileSync(new URL('../homepage-editor.js',import.meta.url),'utf8');for(const id of ['compat-heading','compat-1','compat-2','scope-heading'])assert.match(html,new RegExp('data-home-block="'+id+'"'));for(const id of ['compat-1','compat-2']){assert.equal(validHomePatch(id,{title:'Titre corrigé',text:'Texte corrigé',image:'/assets/test.webp'}),true);assert.equal(validHomePatch(id,{checkoutUrl:'https://example.com'}),false);}assert.equal(validHomePatch('scope-heading',{text:'Présentation'}),true);for(const [,id] of html.matchAll(/data-home-block="([^"]+)"/g))assert.ok(Object.hasOwn(HOME_FIELDS,id),id);assert.match(js,/offer-access\|compat\|offer-guide/);assert.doesNotMatch(html,/class="bro-compat-note"[^>]*data-home-block/);});

test('offers missing editorial blocks are editable and old content endpoint is owner-only',()=>{const html=readFileSync(new URL('../offres.html',import.meta.url),'utf8'),api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8'),app=readFileSync(new URL('../app.js',import.meta.url),'utf8');for(const id of ['offer-patchnote','offer-crumb','offer-checkout-help'])assert.match(html,new RegExp('data-home-block="'+id+'"'));for(let i=1;i<=3;i++)assert.equal(validHomePatch('offer-guide-'+i,{image:'/assets/test.webp'}),true);for(const [,id] of html.matchAll(/data-home-block="([^"]+)"/g))assert.ok(Object.hasOwn(HOME_FIELDS,id),id);assert.equal(validHomePatch('offer-checkout-help',{text:'Test\u0000'}),false);assert.equal(validHomePatch('offer-patchnote',{href:'https://example.com'}),false);assert.equal(validHomePatch('__proto__',{text:'test'}),false);assert.match(api,/path==='\/api\/site'\|\|path==='\/api\/media'\)\&\&req.method==='POST'\)\{\s*if\(!canEditHomepage\(user\)\)/);assert.match(app,/function editor\(\)\{\s*if\(!user\?\.homeEditor\)return/);assert.doesNotMatch(html,/data-home-block="(?:capability-disclaimer|purchase-guide-warning)"/);});

test('purchase feed rebuilds old index and uses current consent, real Discord display name and avatar',async()=>{
 const b=bucket();
 const p=payment('pay_RECENT','2026-11-24T14:00:00Z','prod_xejMeqvQCPugc');
 const avatar='https://cdn.discordapp.com/avatars/'+discordId+'/current.png';
 b.objects['private/activity/receipts/'+p.id+'.json']={...normalizePayment(p,'life'),discordId};
 b.objects['private/activity/recent-index-v1.json']={items:[]};
 b.objects['private/bro-accounts/v1/'+discordId+'.json']={discordId,username:'bro-generated-12345',displayName:'BroReal#0',avatar};
 b.objects['private/activity/consent/'+discordId+'.json']={showPublic:true};
 let [row]=await recentPurchases(b);
 assert.equal(row.name,'BroReal');assert.equal(row.avatar,avatar);assert.equal(row.planId,'life');
 b.objects['private/activity/consent/'+discordId+'.json']={showPublic:false};
 [row]=await recentPurchases(b);assert.equal(row.name,'Client BRO');assert.equal(row.avatar,null);
});
test('recent purchase names use customer and lifetime color styles',()=>{
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 for(const cls of ['purchase-name-customer','purchase-name-lifetime']){assert.ok(js.includes(cls));assert.ok(css.includes(cls));}
});

test('legacy checkout assistance remains hidden with the Tebex checkout',async()=>{
 const html=readFileSync(new URL('../offres.html',import.meta.url),'utf8');
 assert.match(html,/<div class="checkout-note" hidden data-guest-checkout-note/);
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const sync=js.split('\n').find(line=>line.startsWith('function syncGuideNavigation()'));
 assert.ok(sync);
 const {runInNewContext}=await import('node:vm');
 const note={hidden:true};
 const context={accountReady:false,user:null,document:{querySelectorAll:s=>s==='[data-guest-checkout-note]'?[note]:[]},window:{dispatchEvent(){}},Event:class{}};
 runInNewContext(sync,context);
 context.syncGuideNavigation();assert.equal(note.hidden,true);
 context.accountReady=true;context.syncGuideNavigation();assert.equal(note.hidden,true);
 context.user={discordLinked:true};context.syncGuideNavigation();assert.equal(note.hidden,true);
 context.user=null;context.syncGuideNavigation();assert.equal(note.hidden,true);
});


test('Tebex purchases show the real Discord profile on explicit opt-in and respect opt-out',async()=>{
 const b=bucket();
 const avatar='https://cdn.discordapp.com/avatars/'+discordId+'/profile.png';
 await storeActivity(b,{paymentId:'pay_tebex123',provider:'tebex',transactionId:'tbx-example',planId:'week',plan:'Pass Semaine',date:'2026-11-25T00:04:00Z',amount:15,currency:'EUR',discordId,name:'Client BRO',avatar:null,publicIdentity:false});
 assert.equal((await recentPurchases(b))[0].name,'Client BRO');
 await setActivityPreference(b,{discordId,username:'internal-bro-handle',discordUsername:'RealDiscord',discordAvatar:avatar},true);
 let [row]=await recentPurchases(b);
 assert.equal(row.name,'RealDiscord');assert.equal(row.avatar,avatar);
 assert.equal(row.transactionId,undefined);assert.equal(row.discordId,undefined);
 await setActivityPreference(b,{discordId},false);
 [row]=await recentPurchases(b);assert.equal(row.name,'Client BRO');assert.equal(row.avatar,null);
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.ok(js.includes("viewport.append(profileVisibilitySetting());\n      viewport.append(smallButton('Actualiser mes accès'"));
 assert.ok(js.includes("if(document.querySelector('#purchaseBoard'))refreshRecentBoard();"));
});
