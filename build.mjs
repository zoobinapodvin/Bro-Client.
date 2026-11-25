import {spawnSync} from 'node:child_process';
for(const script of ['app.js','api/platform.js','lib/fulfillment.mjs','lib/discord.mjs','lib/purchase-notify.mjs','lib/patchnotes.mjs','patchnotes.js','lib/activity.mjs','lib/checkout.mjs','lib/tebex.mjs','lib/accounts.mjs','key-stock.js','xlsx-stock.js','lib/customer-guides.mjs','lib/homepage.mjs','homepage-editor.js']){
  const check=spawnSync(process.execPath,['--check',script],{stdio:'inherit'});
  if(check.status!==0)throw Error('JavaScript syntax check failed: '+script);
}
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs','tests/discord-oauth-route.test.mjs','tests/secure-portal.test.mjs','tests/activity-ui.test.mjs','tests/checkout-guest.test.mjs','tests/purchase-feed.test.mjs','tests/patchnotes-notify.test.mjs','tests/accounts.test.mjs','tests/tebex.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js','patchnotes.html','patchnotes.js','key-stock.js','key-stock.css','xlsx-stock.js','homepage-editor.js']) await cp(path,'dist/'+path,{recursive:true});

// The old static installation pages are retired. No guide HTML is shipped in dist.
await cp('guides.css','dist/guides.css');


// Temporary read-only diagnosis for a reported paid checkout.
// No payment, license or Discord state is changed; no personal data is logged.
if(process.env.VERCEL_ENV==='production'){
 try{
  const {bucket}=await import('./lib/storage.mjs');
  const read=async key=>{const b=await bucket.get(key);return b?await b.json():null;};
  const orders=[];let cursor;
  for(let page=0;page<5;page++){
   const batch=await bucket.list({prefix:'private/tebex/orders/',limit:100,cursor});
   for(const item of batch.objects){const o=await read(item.key);if(o&&Date.parse(o.createdAt)>Date.now()-6*3600000)orders.push({o,ref:item.key.split('/').at(-1).replace(/\.json$/,'')});}
   if(!batch.truncated||!batch.cursor)break;cursor=batch.cursor;
  }
  orders.sort((a,b)=>Date.parse(b.o.createdAt)-Date.parse(a.o.createdAt));
  console.log('Tebex diagnosis: recent orders',orders.length);
  for(const {o,ref} of orders.slice(0,25)){
   const api='https://headless.tebex.io/api/accounts/'+encodeURIComponent(process.env.TEBEX_PUBLIC_TOKEN.trim())+'/baskets/'+encodeURIComponent(o.basketId);
   const r=await fetch(api,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000),redirect:'error'});
   if(!r.ok){console.log('Tebex diagnosis basket HTTP',r.status);continue;}
   const j=await r.json(),b=j.data??j;
   if(b.complete!==true)continue;
   let link;try{link=new URL(b.links?.payment);}catch{}
   const tx=link?.pathname.split('/').at(-1);
   const {createHash}=await import('node:crypto');
   const id=tx&&'pay_tebex'+createHash('sha256').update(tx).digest('hex');
   const receipt=id?await read('private/tebex/payments/'+id+'.json'):null;
   const ent=id?await read('private/discord-entitlements/'+o.discordId+'/'+id):null;
   const marker=id?await read('private/tebex/processed/'+id+'.json'):null;
   console.log('Tebex paid basket diagnosis',{plan:o.planId,match:b.ident===o.basketId,customMatches:b.custom?.bro_order===ref,linkPresent:!!link,linkHost:link?.hostname,linkPathKind:link?.pathname.startsWith('/api/payments/')?'api/payments':'other',packageCount:b.packages?.length,productMatches:String(b.packages?.[0]?.id??b.packages?.[0]?.package?.id)===o.packageId,packageKeys:Object.keys(b.packages?.[0]??{}),currency:b.currency,totalPriceType:typeof b.total_price,receipt:!!receipt,entitlement:!!ent,processed:!!marker,delivery:marker?.delivery});
  }
  const inv=await bucket.get('private/licenses/inventory-v1.json',{forWrite:true});
  if(inv){const state=await inv.json();console.log('Tebex stock diagnostic',Object.fromEntries(['day','week','month','life'].map(p=>[p,state.keys.filter(k=>k.planId===p&&!k.paymentId&&!k.legacy&&!k.blockedStatus).length])));}
 }catch(e){console.log('Tebex diagnosis exception',e?.name,String(e?.message??'').replace(/https?:\/\/\S+/g,'[url]').replace(/[a-zA-Z0-9_-]{20,}/g,'[redacted]').slice(0,160),String(e?.stack??'').split('\n').slice(1,4).map(x=>x.replace(/https?:\/\/\S+/g,'[url]')).join(' | '));}
}
