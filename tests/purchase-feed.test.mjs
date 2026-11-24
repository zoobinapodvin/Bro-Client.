import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalizePayment,backfillWhopHistory,recentPurchases,setActivityPreference} from '../lib/activity.mjs';
import {handleBilling,createCheckout,attachVerifiedPayment,recoverAttributedPayment} from '../lib/billing.mjs';

process.env.WHOP_ACCOUNT_ID='biz_emxZArodB6p2Af';
const company='biz_emxZArodB6p2Af';
const payment=(overrides={})=>({
 id:'pay_TESTabc123',status:'paid',company:{id:company},
 product:{id:'prod_ZrNuFIODHTxMx'},
 paid_at:'2026-11-23T00:15:00.000Z',total:6,currency:'eur',
 refunded_amount:0,auto_refunded:false,metadata:{},
 ...overrides
});
const bucket=()=>{
 const map=new Map();
 return {
  map,
  get:async key=>map.has(key)?{json:async()=>JSON.parse(map.get(key))}:null,
  put:async (key,data)=>{map.set(key,String(data));return {etag:'test'};},
  head:async key=>map.has(key)?{etag:'test'}:null,
  list:async ({prefix})=>({objects:[...map.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false})
 };
};
test('confirmed receipt can be normalized even when Whop omits status in response',()=>{
 const record=normalizePayment(payment({status:undefined}), 'day');
 assert.equal(record.plan,'Pass Jour');
 assert.equal(record.amount,6);
 assert.equal(record.name,'Client BRO');
 assert.equal(record.date,'2026-11-23T00:15:00.000Z');
});
test('never show unpaid, refunded or different-company receipts',()=>{
 assert.equal(normalizePayment(payment({paid_at:null}),'day'),null);
 assert.equal(normalizePayment(payment({status:'pending'}),'day'),null);
 assert.equal(normalizePayment(payment({refunded_at:'2026-11-23T00:17:00Z'}),'day'),null);
 assert.equal(normalizePayment(payment({refunded_amount:2}),'day'),null);
 assert.equal(normalizePayment(payment({company:{id:'biz_OTHER'}}),'day'),null);
});
test('historical Whop import omits forced API version and stores real payments',async t=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 const calls=[];
 globalThis.fetch=async (url,opts)=>{
  calls.push({url:String(url),version:opts.headers['Api-Version-Date']});
  return Response.json({data:[payment(),payment({id:'pay_TESTunpaid',status:'open'}),
    payment({id:'pay_TESTunknown',product:{id:'prod_other'}})],
    page_info:{has_next_page:false}});
 };
 const b=bucket();
 const result=await backfillWhopHistory(b,{apiKey:'test-not-real',accountId:company});
 assert.equal(result.status,'ok');
 assert.equal(result.imported,1);
 assert.equal(calls[0].version,undefined);
 const recent=await recentPurchases(b);
 assert.equal(recent.length,1);
 assert.equal(recent[0].amount,6);
 assert.equal(recent[0].name,'Client BRO');
});
test('Whop plan ID and company_id variations import the matching pass',async t=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>Response.json({
  data:[payment({id:'pay_planOnly',product:null,plan:{id:'plan_kPcl5mzGmRq2Q'},company:null,company_id:company,total:15})],
  page_info:{has_next_page:false}
 });
 const b=bucket();
 const result=await backfillWhopHistory(b,{apiKey:'test-not-real',accountId:company});
 assert.equal(result.imported,1);
 const recent=await recentPurchases(b);
 assert.equal(recent[0].plan,'Pass Semaine');
 assert.equal(recent[0].amount,15);
});
test('signed direct Whop payment succeeds without a Bro order and never grants Discord access',async t=>{
 const original=globalThis.fetch;
 const privateNotice=process.env.BRO_DISCORD_WEBHOOK_DAY;
 const publicNotice=process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY;
 delete process.env.BRO_DISCORD_WEBHOOK_DAY;
 delete process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY;
 t.after(()=>{
  globalThis.fetch=original;
  if(privateNotice===undefined)delete process.env.BRO_DISCORD_WEBHOOK_DAY;
  else process.env.BRO_DISCORD_WEBHOOK_DAY=privateNotice;
  if(publicNotice===undefined)delete process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY;
  else process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY=publicNotice;
 });
 const b=bucket();
 globalThis.fetch=async (url)=>{
  assert.match(String(url),/api\.whop\.com\/api\/v1\/payments\/pay_TESTabc123/);
  return Response.json(payment({status:undefined}));
 };
 const event=JSON.stringify({type:'payment.succeeded',account_id:company,data:{id:'pay_TESTabc123'}});
 const timestamp=String(Math.floor(Date.now()/1000));
 const webhookId='msg_test_payment';
 const secret='test-only-signing-secret';
 const signature=createHmac('sha256',secret).update(webhookId+'.'+timestamp+'.'+event).digest('base64');
 const req=new Request('https://www.broclient.com/api/whop/webhook',{method:'POST',
  headers:{'webhook-timestamp':timestamp,'webhook-id':webhookId,'webhook-signature':'v1,'+signature,
    'Content-Type':'application/json'},body:event});
 const res=await handleBilling(req,{BUCKET:b,WHOP_API_KEY:'test-only',WHOP_ACCOUNT_ID:company,WHOP_WEBHOOK_SECRET:secret},null);
 assert.equal(res.status,200);
 assert.equal((await res.json()).received,true);
 assert.ok(b.map.has('private/activity/receipts/pay_TESTabc123.json'));
 assert.equal([...b.map.keys()].filter(v=>v.startsWith('private/discord-entitlements/')).length,0);
});

test('authenticated Discord checkout creates a Whop order reference without leaking the Discord ID',async t=>{
 const old=globalThis.fetch;
 t.after(()=>globalThis.fetch=old);
 const b=bucket();
 const u={id:'supabase-tested',discordId:'1574096900000000001',discordUsername:'n7umber#0',
  discordAvatar:'https://cdn.discordapp.com/avatars/1574096900000000001/testavatar.png'};
 const plan={id:'day',name:'Pass Jour',price:6,checkoutUrl:'https://whop.com/checkout/plan_MCtWYReKKKb9m/'};
 let metadata;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://api.whop.com/api/v1/checkout_configurations');
  assert.equal(options.method,'POST');
  assert.match(options.headers['Idempotency-Key'],/^bro-checkout-/);
  assert.equal(options.headers['Api-Version-Date'],'2026-11-20');
  const request=JSON.parse(options.body);
  assert.equal(request.variant_id,'plan_MCtWYReKKKb9m');
  assert.equal(request.account_id,company);
  assert.equal(Object.keys(request.metadata).length,1);
  assert.match(request.metadata.bro_order,/^[a-f0-9-]{36}$/);
  assert.ok(!options.body.includes(u.discordId));
  metadata=request.metadata;
  return Response.json({id:'ch_TESTabc123',account_id:company,
   variant:{id:request.variant_id,currency:'eur',initial_price:6},
   purchase_url:'https://whop.com/checkout/ch_TESTabc123'});
 };
 const dest=await createCheckout({BUCKET:b,WHOP_API_KEY:'test-only',WHOP_ACCOUNT_ID:company,
   WHOP_WEBHOOK_SECRET:'test-secret'},u,plan,'https://www.broclient.com');
 assert.equal(dest,'https://whop.com/checkout/ch_TESTabc123');
 const saved=JSON.parse(b.map.get('private/orders/'+metadata.bro_order));
 assert.equal(saved.discordId,u.discordId);
 assert.equal(saved.identity.username,'n7umber#0');
 assert.equal(saved.checkoutId,'ch_TESTabc123');
});

test('verified webhook links attributed payment to Discord and publishes only opted-in avatar',async t=>{
 const original=globalThis.fetch;
 const oldWebhooks=Object.fromEntries(['BRO_DISCORD_WEBHOOK_DAY','BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY'].map(k=>[k,process.env[k]]));
 delete process.env.BRO_DISCORD_WEBHOOK_DAY;delete process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY;
 t.after(()=>{
  globalThis.fetch=original;
  for(const [k,v] of Object.entries(oldWebhooks))if(v===undefined)delete process.env[k];else process.env[k]=v;
 });
 const b=bucket(),discordId='1574096900000000001';
 const user={discordId,discordUsername:'n7umber#0',discordAvatar:'https://cdn.discordapp.com/avatars/1574096900000000001/avatar.png'};
 await setActivityPreference(b,user,true);
 const ref='39a1a1ec-f1d2-44a9-90ac-e8ed0f0f1234';
 b.map.set('private/orders/'+ref,JSON.stringify({
  owner:'private-owner',discordId,variant:'plan_MCtWYReKKKb9m',planId:'day',
  checkoutId:'ch_TESTabc123',title:'Pass Jour',identity:{username:user.discordUsername,avatar:user.discordAvatar}
 }));
 globalThis.fetch=async(url)=>{
  assert.match(String(url),/\/payments\/pay_TESTabc123/);
  return Response.json(payment({metadata:{bro_order:ref},variant_id:'plan_MCtWYReKKKb9m',
   checkout_configuration_id:'ch_TESTabc123',account_id:company}));
 };
 const event=JSON.stringify({type:'payment.succeeded',account_id:company,data:{id:'pay_TESTabc123'}});
 const secret='test-only-secret';
 const stamp=String(Math.floor(Date.now()/1000));
 const id='webhook_test_metadata';
 const signature=createHmac('sha256',secret).update(id+'.'+stamp+'.'+event).digest('base64');
 const req=new Request('https://www.broclient.com/api/whop/webhook',{method:'POST',body:event,headers:{
  'webhook-timestamp':stamp,'webhook-id':id,'webhook-signature':'v1,'+signature,
  'content-type':'application/json'}});
 const response=await handleBilling(req,{BUCKET:b,WHOP_API_KEY:'test-key',
  WHOP_ACCOUNT_ID:company,WHOP_WEBHOOK_SECRET:secret},null);
 assert.equal(response.status,200);
 assert.equal((await response.json()).received,true);
 const records=await recentPurchases(b);
 assert.equal(records[0].name,'n7umber');
 assert.equal(records[0].avatar,'https://cdn.discordapp.com/avatars/1574096900000000001/avatar.png');
 assert.ok(b.map.has('private/discord-entitlements/'+discordId+'/pay_TESTabc123'));
});

test('invalid payment variant never links a Discord account despite a matching order reference',async t=>{
 const old=globalThis.fetch;
 t.after(()=>globalThis.fetch=old);
 const b=bucket();
 const ref='a9f6fb67-05ad-4b79-9b80-88abf6041512';
 b.map.set('private/orders/'+ref,JSON.stringify({
   discordId:'1574096900000000001',planId:'day',variant:'plan_MCtWYReKKKb9m',checkoutId:'ch_ABC'
 }));
 globalThis.fetch=async()=>Response.json(payment({metadata:{bro_order:ref},
   variant_id:'plan_OTHER',checkout_configuration_id:'ch_ABC'}));
 const secret='signature-secret',stamp=String(Math.floor(Date.now()/1000)),id='wh_test_mismatch';
 const raw=JSON.stringify({type:'payment.succeeded',account_id:company,data:{id:'pay_TESTabc123'}});
 const sig=createHmac('sha256',secret).update(id+'.'+stamp+'.'+raw).digest('base64');
 const req=new Request('https://www.broclient.com/api/whop/webhook',{method:'POST',body:raw,headers:{
  'webhook-id':id,'webhook-timestamp':stamp,'webhook-signature':'v1,'+sig
 }});
 const r=await handleBilling(req,{BUCKET:b,WHOP_API_KEY:'test',WHOP_ACCOUNT_ID:company,
 WHOP_WEBHOOK_SECRET:secret},null);
 assert.equal(r.status,200);
 assert.equal([...b.map.keys()].filter(k=>k.includes('discord-entitlements/')).length,0);
});


test('checkout rejects Whop permission errors without returning an unlinked payment URL',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);
 const b=bucket(),u={id:'verified-user',discordId:'1574096900000000001'};
 const plan={id:'day',name:'Pass Jour',price:6,checkoutUrl:'https://whop.com/checkout/plan_MCtWYReKKKb9m/'};
 globalThis.fetch=async()=>new Response(null,{status:403});
 await assert.rejects(createCheckout({BUCKET:b,WHOP_API_KEY:'test-only',WHOP_ACCOUNT_ID:company,WHOP_WEBHOOK_SECRET:'test-secret'},u,plan,'https://www.broclient.com'),/whop_api_403/);
 assert.equal([...b.map.keys()].filter(k=>k.startsWith('private/invoices/')).length,0);
});

test('staff reconciliation verifies the actual receipt, links once and blocks conflicting buyers',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const b=bucket(),oldPut=b.put;
 b.put=async(key,data,options={})=>{
  if(options.onlyIf?.etagDoesNotMatch==='*'&&b.map.has(key))return null;
  return oldPut(key,data);
 };
 const env={BUCKET:b,WHOP_API_KEY:'test-only',WHOP_ACCOUNT_ID:company,WHOP_WEBHOOK_SECRET:'test-only'};
 const u={authId:'auth-A',discordId:'1574096900000000001',username:'bro-a',avatar:null};
 const other={authId:'auth-B',discordId:'1574096900000000002',username:'bro-b',avatar:null};
 const operator='1574096900000000003';
 globalThis.fetch=async(url)=>{if(String(url).includes('/payments/'))return Response.json(payment());return new Response(null,{status:204});};
 const first=await attachVerifiedPayment(env,u,'pay_TESTabc123',operator);
 assert.equal(first.status,'linked');
 assert.equal((await attachVerifiedPayment(env,u,'pay_TESTabc123',operator)).status,'linked');
 assert.equal((await attachVerifiedPayment(env,other,'pay_TESTabc123',operator)).status,'conflict');
 assert.equal([...b.map.keys()].filter(k=>k.startsWith('private/invoices/')).length,1);
 assert.equal([...b.map.keys()].filter(k=>k.startsWith('private/discord-entitlements/')).length,1);
 assert.equal((await recentPurchases(b))[0].name,'Client BRO');
 globalThis.fetch=async()=>Response.json(payment({id:'pay_REFUND',refunded_amount:6}));
 assert.equal((await attachVerifiedPayment(env,u,'pay_REFUND',operator)).status,'invalid_payment');
});
test('automatic recovery never links a receipt with no server order',async()=>{
 const b=bucket();
 assert.equal(await recoverAttributedPayment({BUCKET:b,WHOP_ACCOUNT_ID:company},payment()),false);
 assert.equal([...b.map.keys()].filter(k=>k.startsWith('private/discord-entitlements/')).length,0);
});

