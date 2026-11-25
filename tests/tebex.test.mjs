import test from 'node:test';
import assert from 'node:assert/strict';
import {completeTebexPayment,verifyTebexBasket} from '../lib/tebex.mjs';
import {addStockKey,readCustomerKey,stockOverview} from '../lib/fulfillment.mjs';
import {recentPurchases,storeActivity} from '../lib/activity.mjs';
const discordId='1574096900000000001',owner='a'.repeat(64),ref='01234567-1234-1234-1234-0123456789ab',ownerId='1027596385123565569';
const bucket=()=>{const m=new Map();let version=0;return {m,async get(k){const x=m.get(k);return x?{etag:x.etag,json:async()=>structuredClone(x.data)}:null;},async head(k){const x=m.get(k);return x?{etag:x.etag}:null;},async put(k,v,o={}){const old=m.get(k);if(o.onlyIf?.etagDoesNotMatch==='*'&&old||o.onlyIf?.etagMatches&&o.onlyIf.etagMatches!==old?.etag)return null;const etag=String(++version);m.set(k,{data:JSON.parse(v),etag});return {etag};},async list({prefix}){return {objects:[...m.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};}};};
const plans={day:'7832046',week:'7832045',month:'7832044',life:'7832042'};
const prices={day:6,week:15,month:35,life:100};
const eventFor=(plan,tx='tbx-abc123-def456')=>({id:'event1',type:'payment.completed',subject:{transaction_id:tx,status:{id:1},created_at:new Date().toISOString(),price:{amount:prices[plan],currency:'EUR'},products:[{id:Number(plans[plan]),quantity:1}],custom:{bro_order:ref}}});
const setup=async(b,plan)=>{await b.put('private/tebex/orders/'+ref+'.json',JSON.stringify({provider:'tebex',planId:plan,packageId:plans[plan],discordId,owner,basketId:'test-basket-123',createdAt:new Date(Date.now()-1000).toISOString()}));};
test('Tebex delivers exactly one correct key, keeps Whop history, and is replay safe for all four passes',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY,pause=process.env.BRO_KEY_DELIVERY_PAUSED;
 process.env.BRO_KEY_ENCRYPTION_KEY='1'.repeat(64);process.env.BRO_KEY_DELIVERY_PAUSED='false';
 t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;if(pause===undefined)delete process.env.BRO_KEY_DELIVERY_PAUSED;else process.env.BRO_KEY_DELIVERY_PAUSED=pause;});
 for(const plan of Object.keys(plans)){
  const b=bucket();await setup(b,plan);
  await addStockKey(b,{planId:plan,key:'KEY-'+plan+'-ONE',operatorId:ownerId});
  await addStockKey(b,{planId:plan,key:'KEY-'+plan+'-TWO',operatorId:ownerId});
  await storeActivity(b,{paymentId:'pay_WHOP1',planId:'day',plan:'Pass Jour',date:new Date(Date.now()-10000).toISOString(),amount:6,currency:'EUR',name:'Client BRO'});
  const e=eventFor(plan);let verified=0;
  const deps={verifyBasket:async()=>{verified++;return {currency:'EUR',total_price:prices[plan]};},reconcile:async(_,id)=>{assert.equal(id,discordId);return {status:plan==='life'?'role_granted_lifetime':'role_granted'};},notify:async(_,order,p)=>{assert.equal(order.planId,plan);assert.equal(p.transactionId,e.subject.transaction_id);return {ok:true};},publicNotify:async()=>({ok:true,configured:true})};
  const r=await completeTebexPayment(b,e,deps);
  assert.equal(r.status,200);assert.equal(r.body.delivery,'assigned');
  const duplicate=await completeTebexPayment(b,{...e,id:'different-webhook-id'},deps);
  assert.equal(duplicate.status,200);assert.equal(verified,1);
  const s=await stockOverview(b);assert.equal(s.counts[plan].available,1);assert.equal(s.counts[plan].assigned,1);
  const row=s.rows.find(x=>x.paymentId);
  const key=await readCustomerKey(b,discordId,row.paymentId);assert.ok(key);
  assert.equal(await readCustomerKey(b,'1574096900000000002',row.paymentId),null);
  const activity=await recentPurchases(b);assert.equal(activity.length,2);
  assert.equal(activity[0].planId,plan);assert.equal(activity[1].amount,6);
  assert.equal((await b.get('private/invoices/'+owner+'/'+row.paymentId)).json instanceof Function,true);
  const conflict=await completeTebexPayment(b,{...e,subject:{...e.subject,transaction_id:'tbx-second-transaction'}},deps);assert.equal(conflict.status,409);
  assert.equal((await stockOverview(b)).counts[plan].available,1);
 }
});
test('Tebex rejects unrelated products and verifies the completed basket transaction link',async t=>{
 const b=bucket();await setup(b,'day');let called=false;
 const e=eventFor('week');assert.equal((await completeTebexPayment(b,e,{verifyBasket:async()=>{called=true;}})).status,422);assert.equal(called,false);
 const original=globalThis.fetch,token=process.env.TEBEX_PUBLIC_TOKEN;process.env.TEBEX_PUBLIC_TOKEN='test';
 t.after(()=>{globalThis.fetch=original;if(token===undefined)delete process.env.TEBEX_PUBLIC_TOKEN;else process.env.TEBEX_PUBLIC_TOKEN=token;});
 const o={basketId:'test-basket-123',packageId:plans.day},tx='tbx-abc123-def456';
 const response={ident:o.basketId,complete:true,custom:{bro_order:ref},links:{payment:'https://checkout.tebex.io/api/payments/'+tx},packages:[{id:Number(plans.day),qty:1}],total_price:6,currency:'EUR'};
 globalThis.fetch=async()=>Response.json({data:response});assert.equal((await verifyTebexBasket(o,tx,ref)).complete,true);
 await assert.rejects(verifyTebexBasket(o,'tbx-other-transaction',ref),/mismatch/);
 // Actual completed Headless baskets omit the payment link and expose quantity
 // in in_basket. The signed event remains mandatory at the caller.
 globalThis.fetch=async()=>Response.json({data:{...response,links:{checkout:'https://pay.tebex.io/test-basket-123'},packages:[{id:Number(plans.day),in_basket:{quantity:1}}]}});
 assert.equal((await verifyTebexBasket(o,tx,ref)).complete,true);
 await assert.rejects(verifyTebexBasket(o,tx,'different-reference'),/not_confirmed/);
 globalThis.fetch=async()=>Response.json({data:{...response,complete:false,links:{},packages:[{id:Number(plans.day),in_basket:{quantity:1}}]}});
 await assert.rejects(verifyTebexBasket(o,tx,ref),/not_confirmed/);
 globalThis.fetch=async()=>Response.json({data:{...response,links:{},packages:[{id:Number(plans.week),in_basket:{quantity:1}}]}});
 await assert.rejects(verifyTebexBasket(o,tx,ref),/products_mismatch/);
 globalThis.fetch=async()=>Response.json({data:{...response,links:{},packages:[{id:Number(plans.day),in_basket:{quantity:2}}]}});
 await assert.rejects(verifyTebexBasket(o,tx,ref),/products_mismatch/);

});
