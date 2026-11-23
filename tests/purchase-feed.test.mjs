import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalizePayment,backfillWhopHistory,recentPurchases} from '../lib/activity.mjs';
import {handleBilling} from '../lib/billing.mjs';

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
