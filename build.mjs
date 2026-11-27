import {spawnSync} from 'node:child_process';
for(const script of ['app.js','api/platform.js','lib/fulfillment.mjs','lib/purchase-receipt.mjs','lib/discord.mjs','lib/purchase-notify.mjs','lib/patchnotes.mjs','patchnotes.js','lib/activity.mjs','lib/checkout.mjs','lib/tebex.mjs','lib/accounts.mjs','key-stock.js','xlsx-stock.js','lib/customer-guides.mjs','lib/homepage.mjs','homepage-editor.js']){
  const check=spawnSync(process.execPath,['--check',script],{stdio:'inherit'});
  if(check.status!==0)throw Error('JavaScript syntax check failed: '+script);
}
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs','tests/discord-oauth-route.test.mjs','tests/secure-portal.test.mjs','tests/activity-ui.test.mjs','tests/checkout-guest.test.mjs','tests/purchase-feed.test.mjs','tests/patchnotes-notify.test.mjs','tests/accounts.test.mjs','tests/tebex.test.mjs','tests/purchase-receipt.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','espace-client.html','account.css','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js','patchnotes.html','patchnotes.js','key-stock.js','key-stock.css','xlsx-stock.js','homepage-editor.js']) await cp(path,'dist/'+path,{recursive:true});

// The old static installation pages are retired. No guide HTML is shipped in dist.
await cp('guides.css','dist/guides.css');

// One-time owner-authorized return of a previously revoked, unused complimentary license.
if(process.env.VERCEL_ENV==='production'){
 const {bucket}=await import('./lib/storage.mjs');
 const {listPaidPurchases,readCustomerKey,stockOverview}=await import('./lib/fulfillment.mjs');
 const first='pay_tebex563953e8466024651b902a6f8e4e82f6e49150cd1278cc3670af9c9353f5a751';
 const second='pay_tebex1ca536d39ad0d77e3c9695e38c9a224048dfccc8844f323efc0205e1396340cd';
 const path='private/licenses/inventory-v1.json';
 const read=async p=>{const e=await bucket.get(p);return e?await e.json():null;};
 const guard=(ok,label)=>{if(!ok)throw Error('stock_return_guard_'+label);};
 const [a,b]=await Promise.all([first,second].map(id=>read('private/tebex/payments/'+id+'.json')));
 guard(a?.paymentId===first&&b?.paymentId===second&&a.provider==='tebex'&&b.provider==='tebex'&&a.amount===0&&b.amount===0&&a.planId==='week'&&b.planId==='week'&&a.currency==='EUR'&&b.currency==='EUR'&&a.discordId===b.discordId&&/^\d{17,20}$/.test(b.discordId)&&a.owner===b.owner&&/^[a-f0-9]{64}$/.test(b.owner),'receipts');
 const ent=id=>'private/discord-entitlements/'+b.discordId+'/'+id;
 const inv=id=>'private/invoices/'+b.owner+'/'+id;
 const [keep,removed,archived]=await Promise.all([read(ent(first)),read(ent(second)),read(inv(second))]);
 guard(keep?.paymentId===first&&!keep.revokedAt&&keep.transactionId===a.transactionId&&removed?.paymentId===second&&removed.transactionId===b.transactionId&&removed.revokedAt&&removed.retainedPaymentId===first&&archived?.id===second&&archived.revokedAt,'revoked_order');
 const keepRow=k=>k.paymentId===first&&k.discordId===b.discordId&&k.planId==='week'&&k.id.startsWith('c840b5794d968f14')&&!k.revokedAt&&!k.blockedStatus;
 const target=k=>k.id.startsWith('c80bf12d3e215410')&&k.planId==='week'&&!k.legacy;
 let done=false,targetId;
 for(let i=0;i<12;i++){
  const e=await bucket.get(path,{forWrite:true});guard(e?.etag,'revision');
  const state=await e.json();
  guard(state.v===1&&Array.isArray(state.keys)&&Array.isArray(state.pending)&&state.keys.filter(keepRow).length===1&&state.keys.filter(target).length===1,'inventory');
  const row=state.keys.find(target);targetId=row.id;
  guard(!state.pending.some(p=>p.paymentId===second),'old_pending');
  // Idempotency: never release this key again if it has already been returned and sold.
  if(row.returnedFromPaymentId===second){done=true;break;}
  guard(row.paymentId===second&&row.discordId===b.discordId&&row.revokedAt&&row.blockedStatus==='quarantine'&&row.encrypted?.v===1,'target');
  guard(!state.pending.some(p=>p.planId==='week'&&(p.expiresAt===null||Date.parse(p.expiresAt)>Date.now())),'pending_week_orders');
  const restored={id:row.id,planId:row.planId,encrypted:row.encrypted,createdAt:row.createdAt,returnedFromPaymentId:second,returnedToStockAt:new Date().toISOString()};
  state.keys[state.keys.indexOf(row)]=restored;
  if(await bucket.put(path,JSON.stringify(state),{onlyIf:{etagMatches:e.etag}})){done=true;break;}
 }
 guard(done,'concurrent_updates');
 const final=await stockOverview(bucket),row=final.rows.find(k=>k.id===targetId);
 const purchases=await listPaidPurchases(bucket,b.discordId);
 guard(purchases.some(p=>p.paymentId===first)&&!purchases.some(p=>p.paymentId===second)&&await readCustomerKey(bucket,b.discordId,second)===null,'customer_access');
 guard(row&&row.paymentId!==second&&final.rows.some(k=>k.paymentId===first&&k.id.startsWith('c840b5794d968f14')),'inventory_final');
 guard((await read(ent(second)))?.revokedAt&&(await read(inv(second)))?.revokedAt,'archive_final');
 console.info('BRO one-time stock return VERIFIED: '+row.status+'; revoked order remains revoked; first purchase retained.');
}
