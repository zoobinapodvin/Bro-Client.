import test from 'node:test';
import assert from 'node:assert/strict';
import {completeTebexPayment,verifyTebexBasket,recoverConfiguredTebexPayment,fetchTebexPayment,retryTebexPublicNotices} from '../lib/tebex.mjs';
import {addStockKey,readCustomerKey,stockOverview,revokeDuplicateComplimentaryPurchase} from '../lib/fulfillment.mjs';
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
  const storedInvoice=await (await b.get('private/invoices/'+owner+'/'+row.paymentId)).json();assert.match(storedInvoice.broReference,/^bro-\d{24}$/);assert.equal(storedInvoice.transactionId,e.subject.transaction_id);
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

test('100% Tebex promotions deliver the correct pass, role and notification once; rejects unverified zero totals',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY,pause=process.env.BRO_KEY_DELIVERY_PAUSED;
 process.env.BRO_KEY_ENCRYPTION_KEY='2'.repeat(64);process.env.BRO_KEY_DELIVERY_PAUSED='false';
 t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;if(pause===undefined)delete process.env.BRO_KEY_DELIVERY_PAUSED;else process.env.BRO_KEY_DELIVERY_PAUSED=pause;});
 for(const plan of Object.keys(plans)){
  const b=bucket();await setup(b,plan);
  await addStockKey(b,{planId:plan,key:'PROMO-'+plan+'-KEY',operatorId:ownerId});
  const other=plan==='day'?'week':'day';await addStockKey(b,{planId:other,key:'WRONG-PASS-KEY',operatorId:ownerId});
  const event=eventFor(plan);event.subject.price.amount=0;let role=0,notification=0,publicNotice=0;
  const deps={verifyBasket:async()=>({currency:'EUR',total_price:0}),reconcile:async(_,id)=>{assert.equal(id,discordId);role++;return {status:plan==='life'?'role_granted_lifetime':'role_granted'};},notify:async(_,o,p)=>{assert.equal(o.planId,plan);assert.equal(p.amount_charged.amount,0);notification++;return {ok:true};},publicNotify:async(_,p)=>{assert.equal(p.amount,0);publicNotice++;return {ok:true,configured:true};}};
  for(const price of [-1,null,'0']){const bad=structuredClone(event);bad.subject.price.amount=price;assert.equal((await completeTebexPayment(b,bad,deps)).status,422);}
  for(const total of [prices[plan],null,undefined])assert.equal((await completeTebexPayment(b,event,{...deps,verifyBasket:async()=>({currency:'EUR',total_price:total})})).status,422);
  assert.equal((await completeTebexPayment(b,{...event,subject:{...event.subject,status:{id:0}}},deps)).status,422);
  assert.equal((await stockOverview(b)).counts[plan].available,1);
  assert.equal((await completeTebexPayment(b,event,deps)).body.delivery,'assigned');
  const row=(await stockOverview(b)).rows.find(r=>r.paymentId);
  assert.equal(await readCustomerKey(b,discordId,row.paymentId),'PROMO-'+plan+'-KEY');
  assert.equal((await recentPurchases(b))[0].amount,0);
  assert.equal((await (await b.get('private/invoices/'+owner+'/'+row.paymentId)).json()).amount,0);
  assert.equal(role,1);assert.equal(notification,1);assert.equal(publicNotice,1);
  assert.equal((await completeTebexPayment(b,event,deps)).status,200);
  assert.equal(role,1);assert.equal(publicNotice,1);
  assert.equal((await stockOverview(b)).counts[other].available,1);
  assert.equal((await stockOverview(b)).counts[plan].assigned,1);
  assert.equal((await recoverConfiguredTebexPayment(b,{transactionId:event.subject.transaction_id,fetchPayment:async()=>{throw Error('already done');}})).status,'already_processed');
 }
});
test('configured Tebex recovery fetches the exact completed transaction and cannot trust a different one',async t=>{
 const b=bucket(),event=eventFor('day');event.subject.price.amount=0;let completed=0;
 const complete=async(_,e)=>{assert.deepEqual(e.subject,event.subject);completed++;return {status:200,body:{delivery:'assigned'}};};
 const transactionId=event.subject.transaction_id;
 assert.equal((await recoverConfiguredTebexPayment(b,{transactionId,fetchPayment:async()=>({...event.subject,transaction_id:'tbx-other-123'}),complete})).status,'unverified_payment');
 assert.equal((await recoverConfiguredTebexPayment(b,{transactionId,fetchPayment:async()=>({...event.subject,status:{id:0}}),complete})).status,'unverified_payment');
 assert.equal(completed,0);
 assert.equal((await recoverConfiguredTebexPayment(b,{transactionId,fetchPayment:async()=>event.subject,complete})).delivery,'assigned');assert.equal(completed,1);
 const previousFetch=globalThis.fetch,project=process.env.TEBEX_PROJECT_ID,secret=process.env.TEBEX_PRIVATE_KEY;
 t.after(()=>{globalThis.fetch=previousFetch;if(project===undefined)delete process.env.TEBEX_PROJECT_ID;else process.env.TEBEX_PROJECT_ID=project;if(secret===undefined)delete process.env.TEBEX_PRIVATE_KEY;else process.env.TEBEX_PRIVATE_KEY=secret;});
 process.env.TEBEX_PROJECT_ID='test-project';process.env.TEBEX_PRIVATE_KEY='test-key';
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://checkout.tebex.io/api/payments/'+transactionId+'?type=txn_id');assert.equal(options.headers.Authorization,'Basic '+Buffer.from('test-project:test-key').toString('base64'));return Response.json(event.subject);};
 assert.deepEqual(await fetchTebexPayment(transactionId),event.subject);
});

test('Discord public 404 never rejects two distinct purchases by the same account; independent retry is idempotent',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY,pause=process.env.BRO_KEY_DELIVERY_PAUSED;
 process.env.BRO_KEY_ENCRYPTION_KEY='3'.repeat(64);process.env.BRO_KEY_DELIVERY_PAUSED='false';
 t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;if(pause===undefined)delete process.env.BRO_KEY_DELIVERY_PAUSED;else process.env.BRO_KEY_DELIVERY_PAUSED=pause;});
 const b=bucket(),secondRef='01234567-1234-1234-1234-0123456789ac';
 await setup(b,'day');const original=await (await b.get('private/tebex/orders/'+ref+'.json')).json();
 await b.put('private/tebex/orders/'+secondRef+'.json',JSON.stringify(original));
 for(const key of ['TEST-FIRST-KEY','TEST-SECOND-KEY','TEST-SPARE-KEY'])await addStockKey(b,{planId:'day',key,operatorId:ownerId});
 let verified=0,roles=0;
 const deps={verifyBasket:async()=>{verified++;return {currency:'EUR',total_price:6};},reconcile:async()=>{roles++;return {status:'role_granted'};},notify:async()=>({ok:true}),publicNotify:async()=>({configured:true,ok:false,status:404})};
 const first=eventFor('day','tbx-repeat-first'),second=eventFor('day','tbx-repeat-second');second.subject.custom.bro_order=secondRef;
 for(const event of [first,second,first,second]){const result=await completeTebexPayment(b,event,deps);assert.equal(result.status,200);assert.equal(result.body.delivery,'assigned');}
 assert.equal(verified,2);assert.equal(roles,2);
 const stock=await stockOverview(b);assert.equal(stock.counts.day.assigned,2);assert.equal(stock.counts.day.available,1);
 const assigned=stock.rows.filter(r=>r.paymentId);assert.notEqual(assigned[0].paymentId,assigned[1].paymentId);
 assert.notEqual(await readCustomerKey(b,discordId,assigned[0].paymentId),await readCustomerKey(b,discordId,assigned[1].paymentId));
 for(const r of assigned){const marker='private/tebex/processed/'+r.paymentId+'.json';assert.equal((await (await b.get(marker)).json()).publicOk,false);await b.put(marker+'.public-lease',JSON.stringify({until:0}));}
 let announcements=0;
 const retry=await retryTebexPublicNotices(b,{publicNotify:async()=>{announcements++;return {ok:true,configured:true};}});
 assert.equal(retry.sent,2);assert.equal(announcements,2);
 await retryTebexPublicNotices(b,{publicNotify:async()=>{throw Error('already sent');}});
 assert.equal(announcements,2);assert.equal((await stockOverview(b)).counts.day.assigned,2);
 const rejected=eventFor('day','tbx-unverified-new');rejected.subject.status.id=0;
 assert.equal((await completeTebexPayment(b,rejected,deps)).status,422);
});

test('owner can withdraw only a verified second complimentary purchase, retaining the first and quarantining the exposed key',async t=>{
 const old=process.env.BRO_KEY_ENCRYPTION_KEY,pause=process.env.BRO_KEY_DELIVERY_PAUSED;
 process.env.BRO_KEY_ENCRYPTION_KEY='4'.repeat(64);process.env.BRO_KEY_DELIVERY_PAUSED='false';
 t.after(()=>{if(old===undefined)delete process.env.BRO_KEY_ENCRYPTION_KEY;else process.env.BRO_KEY_ENCRYPTION_KEY=old;if(pause===undefined)delete process.env.BRO_KEY_DELIVERY_PAUSED;else process.env.BRO_KEY_DELIVERY_PAUSED=pause;});
 const b=bucket(),secondRef='01234567-1234-1234-1234-0123456789ac';
 await setup(b,'week');const original=await (await b.get('private/tebex/orders/'+ref+'.json')).json();
 await b.put('private/tebex/orders/'+secondRef+'.json',JSON.stringify(original));
 for(const key of ['FIRST-FREE-KEY','SECOND-FREE-KEY','SPARE-KEY'])await addStockKey(b,{planId:'week',key,operatorId:ownerId});
 const first=eventFor('week','tbx-complimentary-first'),second=eventFor('week','tbx-complimentary-second');
 first.subject.price.amount=0;second.subject.price.amount=0;second.subject.custom.bro_order=secondRef;second.subject.created_at=new Date(Date.parse(first.subject.created_at)+1000).toISOString();
 const deps={verifyBasket:async()=>({currency:'EUR',total_price:0}),reconcile:async()=>({status:'role_granted'}),notify:async()=>({ok:true}),publicNotify:async()=>({ok:true,configured:true})};
 for(const e of [first,second])assert.equal((await completeTebexPayment(b,e,deps)).status,200);
 const rows=(await stockOverview(b)).rows.filter(r=>r.paymentId);
 const target=rows.find(r=>r.paymentId&&r.id&&b.m.get('private/tebex/payments/'+r.paymentId+'.json')?.data.transactionId===second.subject.transaction_id);
 const keep=rows.find(r=>r!==target);
 const input={operatorId:ownerId,keyId:target.id,paymentId:target.paymentId,firstTransaction:first.subject.transaction_id};
 assert.equal((await revokeDuplicateComplimentaryPurchase(b,{...input,operatorId:discordId})).status,'invalid');
 assert.equal((await revokeDuplicateComplimentaryPurchase(b,{...input,keyId:keep.id})).status,'not_verified_duplicate');
 assert.equal((await revokeDuplicateComplimentaryPurchase(b,input)).status,'quarantined');
 assert.equal((await revokeDuplicateComplimentaryPurchase(b,input)).status,'quarantined');
 assert.equal(await readCustomerKey(b,discordId,target.paymentId),null);
 assert.equal(await readCustomerKey(b,discordId,keep.paymentId),'FIRST-FREE-KEY');
 assert.equal((await completeTebexPayment(b,second,deps)).body.delivery,'revoked');
 const stock=await stockOverview(b);assert.equal(stock.counts.week.available,1);assert.equal(stock.counts.week.assigned,1);assert.equal(stock.rows.find(r=>r.id===target.id).status,'quarantine');
});
