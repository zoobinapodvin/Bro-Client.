import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkoutDestination,authenticatedCheckoutDestination} from '../lib/checkout.mjs';

const config=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
const legacyPlan={...config.plans[0],checkoutUrl:'https://whop.com/checkout/plan_MCtWYReKKKb9m/'};
test('all four offers let guests buy directly, with no account or Whop API request',async()=>{
 for(const plan of config.plans){
   let called=false;
   const result=await checkoutDestination({},null,plan,'https://www.broclient.com',async()=>{called=true;throw Error('must not run');});
   assert.equal(result,plan.checkoutUrl);
   assert.equal(called,false);
 }
});
test('signed-in buyer gets an attributed checkout only when available',async()=>{
 const plan=legacyPlan;
 const result=await checkoutDestination({}, {id:'uid',discordId:'1574096900000000001'},plan,'https://www.broclient.com',
   async()=> 'https://whop.com/checkout/ch_1234');
 assert.equal(result,'https://whop.com/checkout/ch_1234');
});
test('signed-in buyer falls back to official checkout when API key is read-only or Whop fails',async()=>{
 const plan=legacyPlan;
 const result=await checkoutDestination({}, {id:'uid'},plan,'https://www.broclient.com',async()=>{
   throw new Error('Whop 403 - cannot create checkout');
 });
 assert.equal(result,plan.checkoutUrl);
});
test('invalid or off-domain checkout links cannot be injected',async()=>{
 const plan={...config.plans[0],checkoutUrl:'https://evil.invalid/checkout/plan_Z123'};
 await assert.rejects(checkoutDestination({},null,plan,'https://www.broclient.com',async()=>{}));
 const result=await checkoutDestination({}, {id:'uid'},config.plans[0],'https://www.broclient.com',async()=>{
  return 'https://evil.invalid/checkout/ch_1234';
 });
 assert.equal(result,config.plans[0].checkoutUrl);
});
test('checkout UI and explanatory text require Discord',()=>{
 const src=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 const site=readFileSync(new URL('../offres.html',import.meta.url),'utf8');
 assert.match(src,/if\(!user\?\.discordId\|\|/);
 assert.doesNotMatch(src,/return res\.redirect\(302,target\.href\)/);
 assert.match(site,/Connexion Discord requise/);
 assert.match(config.content.a3,/Oui\. Connecte-toi avec Discord/);
});

test('production authenticated checkout fails closed on Whop 403',async()=>{
 const user={id:'verified-user',discordId:'1574096900000000001'};
 for(const plan of config.plans){
   await assert.rejects(authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async()=>{throw Error('whop_api_403')}),/whop_api_403/);
 }
});
test('production checkout preserves attributed success, rejects guests and fails closed on integrity errors',async()=>{
 const user={id:'verified-user',discordId:'1574096900000000001'},plan=legacyPlan;
 assert.deepEqual(await authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async()=> 'https://whop.com/checkout/ch_1234'),{url:'https://whop.com/checkout/ch_1234',attributed:true});
 await assert.rejects(authenticatedCheckoutDestination({},null,plan,'https://www.broclient.com',async()=>{throw Error('must not run')}),/discord_session_required/);
 await assert.rejects(authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async()=>{throw Error('checkout_price_mismatch')}),/checkout_price_mismatch/);
 await assert.rejects(authenticatedCheckoutDestination({},user,{...plan,checkoutUrl:'https://evil.invalid/checkout/plan_123'},'https://www.broclient.com',async()=>{throw Error('whop_api_403')}),/Invalid official/);
 const src=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(src,/https:\/\/headless\.tebex\.io\/api/);
 assert.match(src,/return res\.redirect\(303,target\)/);
});

test('all new plans use authenticated dynamic checkouts and no fallback',async()=>{
 const expected={"day":"https://whop.com/checkout/plan_2XsZR1EchcSOj","week":"https://whop.com/checkout/plan_sIer2uLNR0Idi","month":"https://whop.com/checkout/plan_jzDhXvlF2aSQc","life":"https://whop.com/checkout/plan_3G7GUcXlBFZJX"};
 const user={id:'verified-user',discordId:'1574096900000000001'};
 for(const plan of config.plans){
  assert.equal(plan.checkoutUrl,expected[plan.id]);
  const result=await authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async(env,verified,offer)=>{assert.equal(verified.discordId,user.discordId);assert.equal(offer.checkoutUrl,expected[plan.id]);return 'https://whop.com/checkout/ch_1234';});
  assert.deepEqual(result,{url:'https://whop.com/checkout/ch_1234',attributed:true});
  await assert.rejects(authenticatedCheckoutDestination({},null,plan,'https://www.broclient.com',async()=>{}),/discord_session_required/);
 }
});
test('old persisted checkout URLs migrate while preserving other storefront settings',async()=>{
 const {readSite,validCheckout}=await import('../lib/store.mjs');
 const saved={...config,checkoutLinksVersion:2,plans:config.plans.map(p=>({...p,checkoutUrl:legacyPlan.checkoutUrl,description:'custom'}))};
 const bucket={get:async()=>({etag:'old',json:async()=>saved})};
 const {site}=await readSite(bucket);
 assert.deepEqual(site.plans.map(p=>p.checkoutUrl),config.plans.map(p=>p.checkoutUrl));
 assert.ok(site.plans.every(p=>p.description==='custom'));
 assert.ok(site.plans.every(p=>validCheckout(p.checkoutUrl)));
 assert.equal(validCheckout('https://evil.invalid/modelya/test'),false);
 assert.equal(validCheckout('https://whop.com/modelya/test?redirect=evil'),false);
 saved.checkoutLinksVersion=3;
 assert.equal((await readSite(bucket)).site.plans[0].checkoutUrl,legacyPlan.checkoutUrl);
});

test('Tebex checkout uses catalog ident, supports required authentication and preserves private attribution',async()=>{
 const src=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 const start=src.indexOf("    if(/^\\/checkout\\/(day|week|month|life)$/.test(path)&&req.method==='GET'){");
 const end=src.indexOf("\n    return res.status(404).end();",start);
 assert.ok(start>=0&&end>start);
 const {runInNewContext}=await import('node:vm');
 const {createHash,randomUUID}=await import('node:crypto');
 const {isIP}=await import('node:net');
 const mapping={day:'7832046',week:'7832045',month:'7832044',life:'7832042'};
 const checkout='https://checkout.tebex.io/checkout/test-basket-123';
 const verified={id:'verified-user',discordId:'1574096900000000001'};
 const run=async(plan,user,{auth=false,callback=null,records=new Map(),target=checkout,feed=null,ip='81.65.2.3',rejectIP=false,privateKey='test-private-key',country='FR'}={})=>{
  const calls=[],redirects=[];
  const context={path:'/checkout/'+plan,parsed:{searchParams:new URLSearchParams(callback?'tebex_order='+callback:feed?'feed='+feed:'')},req:{method:'GET',headers:{'x-vercel-forwarded-for':ip,'x-vercel-ip-country':'FR'}},user,process:{env:{VERCEL:'1',TEBEX_PUBLIC_TOKEN:'test-token',TEBEX_WEBHOOK_SECRET:'test-secret',TEBEX_PRIVATE_KEY:privateKey}},crypto:{randomUUID},createHash,URL,URLSearchParams,AbortSignal,Buffer,isIP,
    console:{error(){},warn(){}},bucket:{get:async k=>records.has(k)?{json:async()=>records.get(k)}:null,put:async(k,v,o)=>{if(records.has(k))return null;records.set(k,JSON.parse(v));return {etag:'saved'};}},
    fetch:async(url,opts)=>{
      calls.push({url,body:opts.body?JSON.parse(opts.body):null,authorization:opts.headers.Authorization});
      if(rejectIP&&new URL(url).searchParams.has('ip_address'))return {ok:false,status:422,json:async()=>({detail:'Invalid IP address'})};
      if(url.includes('/auth?'))return {ok:true,json:async()=>[{name:'Tebex',url:'https://ident.tebex.io/login'}]};
      if(url.includes('/accounts/')&&url.endsWith('/packages/'+mapping[plan]))return {ok:true,json:async()=>({data:{id:Number(mapping[plan]),ident:'catalog-'+mapping[plan]}})};
      if(url.endsWith('/packages')){
       if(auth&&!callback)return {ok:false,status:422,json:async()=>({detail:'User must login before adding packages to basket'})};
       return {ok:true,json:async()=>({ident:'test-basket-123',complete:false,links:{checkout:target}})};
      }
      return {ok:true,json:async()=>({data:{ident:'test-basket-123',packages:[],complete:false,country}})};
    },
    res:{setHeader(){},redirect:(status,url)=>{redirects.push({status,url});return url;}}};
  await runInNewContext('(async()=>{'+src.slice(start,end)+'})()',context);
  return {calls,records,redirects};
 };
 for(const [plan,packageId] of Object.entries(mapping)){
  const r=await run(plan,verified);
  assert.equal(r.calls.length,3);
  assert.equal(new URL(r.calls[0].url).searchParams.get('ip_address'),'81.65.2.3');
  assert.equal(r.calls[0].authorization,'Basic '+Buffer.from('test-token:test-private-key').toString('base64'));
  assert.ok(r.calls.slice(1).every(c=>!c.authorization));
  assert.equal(r.calls[2].body.package_id,'catalog-'+packageId);
  assert.equal(r.calls[2].body.quantity,1);
  const [[key,order]]=[...r.records];
  assert.equal(order.discordId,verified.discordId);
  assert.equal(order.packageId,packageId);
  assert.equal(order.basketId,'test-basket-123');
  assert.ok(key.includes(r.calls[0].body.custom.bro_order));
  assert.equal(r.redirects[0].url,checkout);
 }
 const ipv6=await run('day',verified,{ip:'2001:db8::1'});
 assert.equal(new URL(ipv6.calls[0].url).searchParams.get('ip_address'),'2001:db8::1');
 assert.equal(ipv6.redirects[0].url,checkout);
 const mapped=await run('day',verified,{ip:'::ffff:81.65.2.3'});
 assert.equal(new URL(mapped.calls[0].url).searchParams.get('ip_address'),'81.65.2.3');
 for(const opts of [{ip:'bad-value'},{privateKey:''}]){
  const r=await run('day',verified,opts);
  assert.equal(r.calls.length,3);
  assert.equal(new URL(r.calls[0].url).searchParams.has('ip_address'),false);
  assert.equal(r.calls[0].authorization,undefined);
  assert.equal(r.redirects[0].url,checkout);
 }
 const rejected=await run('day',verified,{rejectIP:true});
 assert.equal(rejected.calls.length,4);
 assert.equal(new URL(rejected.calls[0].url).searchParams.get('ip_address'),'81.65.2.3');
 assert.equal(new URL(rejected.calls[1].url).searchParams.has('ip_address'),false);
 assert.equal(rejected.calls[1].authorization,undefined);
 assert.deepEqual(rejected.calls[0].body,rejected.calls[1].body);
 assert.equal(rejected.redirects[0].url,checkout);
 assert.equal(rejected.records.size,1);
 const guestPublic=await run('day',null,{feed:'public'});
 assert.equal(new URL(guestPublic.redirects[0].url,'https://www.broclient.com').searchParams.get('return_to'),'/checkout/day?feed=public');
 const initial=await run('day',{...verified,discordUsername:'Verified#0',discordAvatar:'https://cdn.discordapp.com/embed/avatars/0.png'},{auth:true,feed:'public'});
 assert.equal([...initial.records.values()][0].feedVisibility,'public');
 assert.equal([...initial.records.values()][0].identity.username,'Verified#0');
 assert.equal(initial.redirects[0].url,'https://ident.tebex.io/login');
 const ref=initial.calls[0].body.custom.bro_order;
 assert.ok(new URL(initial.calls[3].url).searchParams.get('returnUrl').includes(ref));
 const resumed=await run('day',verified,{auth:true,callback:ref,records:initial.records});
 assert.equal(resumed.redirects[0].url,checkout);
 assert.equal(resumed.records.size,1);
 assert.equal([...resumed.records.values()][0].feedVisibility,'public');
 const hidden=await run('day',verified,{feed:'private'});
 assert.equal([...hidden.records.values()][0].feedVisibility,'private');
 const wrong=await run('day',{...verified,discordId:'1574096900000000002'},{callback:ref,records:initial.records});
 assert.equal(wrong.calls.length,0);
 assert.equal(wrong.redirects[0].url,'/offres?paiement=indisponible');
 const guest=await run('day',null);
 assert.equal(guest.calls.length,0);
 assert.match(guest.redirects[0].url,/^\/auth\/discord\?/);
 const invalid=await run('day',verified,{target:'https://evil.invalid/checkout/test'});
 assert.equal(invalid.redirects[0].url,'/offres?paiement=indisponible');
});
