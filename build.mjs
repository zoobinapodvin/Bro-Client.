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

// One-time, transaction-scoped owner-authorized data repair. No public route.
if(process.env.VERCEL_ENV==='production'){
 const {bucket}=await import('./lib/storage.mjs');
 const {readCustomerKey,listPaidPurchases}=await import('./lib/fulfillment.mjs');
 const {createHash}=await import('node:crypto');
 const first='pay_tebex563953e8466024651b902a6f8e4e82f6e49150cd1278cc3670af9c9353f5a751';
 const second='pay_tebex1ca536d39ad0d77e3c9695e38c9a224048dfccc8844f323efc0205e1396340cd';
 const storage='private/licenses/inventory-v1.json';
 const read=async path=>{const entry=await bucket.get(path);return entry?await entry.json():null;};
 const requireMatch=(ok,label)=>{if(!ok)throw Error('duplicate_repair_guard_'+label);};
 const [a,b]=await Promise.all([first,second].map(id=>read('private/tebex/payments/'+id+'.json')));
 const receiptMatches=(r,id)=>r?.provider==='tebex'&&r.paymentId===id&&typeof r.transactionId==='string'&&'pay_tebex'+createHash('sha256').update(r.transactionId).digest('hex')===id&&r.planId==='week'&&r.amount===0&&r.currency==='EUR';
 requireMatch(receiptMatches(a,first)&&receiptMatches(b,second),'receipts');
 requireMatch(a.discordId===b.discordId&&/^\d{17,20}$/.test(b.discordId)&&a.owner===b.owner&&/^[a-f0-9]{64}$/.test(b.owner)&&a.orderRef!==b.orderRef,'ownership');
 const entitlementPath=id=>'private/discord-entitlements/'+b.discordId+'/'+id;
 const invoicePath=id=>'private/invoices/'+b.owner+'/'+id;
 const [keep,remove,invoice,keptInvoice]=await Promise.all([read(entitlementPath(first)),read(entitlementPath(second)),read(invoicePath(second)),read(invoicePath(first))]);
 const validEnt=(e,r)=>e?.paymentId===r.paymentId&&e.transactionId===r.transactionId&&e.planId==='week';
 const validInvoice=(i,r)=>i?.id===r.paymentId&&i.transactionId===r.transactionId&&i.amount===0&&i.provider==='tebex';
 requireMatch(validEnt(keep,a)&&!keep.revokedAt&&validEnt(remove,b),'entitlements');
 requireMatch(validInvoice(invoice,b)&&validInvoice(keptInvoice,a)&&!keptInvoice.revokedAt,'invoices');
 const matches=(k,id,prefix)=>k?.paymentId===id&&k.discordId===b.discordId&&k.planId==='week'&&k.id.startsWith(prefix)&&!k.legacy;
 const keptRow=k=>matches(k,first,'c840b5794d968f14')&&!k.revokedAt&&!k.blockedStatus;
 const targetRow=k=>matches(k,second,'c80bf12d3e215410');
 const initial=await read(storage);
 requireMatch(initial?.v===1&&Array.isArray(initial.keys)&&Array.isArray(initial.pending)&&initial.keys.filter(keptRow).length===1&&initial.keys.filter(targetRow).length===1,'inventory');
 const at=remove.revokedAt||initial.keys.find(targetRow).revokedAt||new Date().toISOString();
 async function mutate(path,edit){
  for(let i=0;i<10;i++){
   const entry=await bucket.get(path,{forWrite:true});requireMatch(entry?.etag,'revision');
   const value=await entry.json();const next=edit(value);
   if(!next)return;
   if(await bucket.put(path,JSON.stringify(next),{onlyIf:{etagMatches:entry.etag}}))return;
  }
  throw Error('duplicate_repair_conflict');
 }
 // Revoke the entitlement first; signed webhook retries cannot regrant it.
 await mutate(entitlementPath(second),e=>{
  requireMatch(validEnt(e,b),'entitlement_revision');
  if(e.revokedAt)return null;
  return {...e,revokedAt:at,revocationReason:'duplicate_complimentary_purchase',retainedPaymentId:first};
 });
 await mutate(storage,state=>{
  requireMatch(state.v===1&&state.keys.filter(keptRow).length===1&&state.keys.filter(targetRow).length===1,'inventory_revision');
  const row=state.keys.find(targetRow);
  if(row.revokedAt&&row.blockedStatus==='quarantine'&&!state.pending.some(p=>p.paymentId===second))return null;
  row.revokedAt=at;row.blockedStatus='quarantine';
  state.pending=state.pending.filter(p=>p.paymentId!==second);
  return state;
 });
 // Retain the original financial record privately, but remove the duplicate from the customer view.
 await mutate(invoicePath(second),i=>{
  requireMatch(validInvoice(i,b),'invoice_revision');
  return i.revokedAt?null:{...i,revokedAt:at,revocationReason:'duplicate_complimentary_purchase'};
 });
 const purchases=await listPaidPurchases(bucket,b.discordId);
 const final=await read(storage);
 requireMatch(purchases.some(p=>p.paymentId===first)&&!purchases.some(p=>p.paymentId===second),'customer_purchases');
 requireMatch(await readCustomerKey(bucket,b.discordId,second)===null,'customer_key');
 requireMatch(final.keys.some(keptRow)&&final.keys.some(k=>targetRow(k)&&k.revokedAt&&k.blockedStatus==='quarantine'),'final_inventory');
 requireMatch((await read(invoicePath(second))).revokedAt,'final_invoice');
 console.info('BRO one-time duplicate repair VERIFIED: second entitlement revoked; second key quarantined; second receipt archived; first purchase retained.');
}else console.info('BRO duplicate repair skipped: non-production environment.');
