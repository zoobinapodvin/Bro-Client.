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


// One-time read-only check of previously confirmed Tebex transactions.
if(process.env.VERCEL_ENV==='production'){
 try{
  const {bucket}=await import('./lib/storage.mjs');
  const {paymentLicenseStatus}=await import('./lib/fulfillment.mjs');
  const {getActivityPreference}=await import('./lib/activity.mjs');
  const {readAccount}=await import('./lib/accounts.mjs');
  const read=async k=>{const b=await bucket.get(k);return b?await b.json():null;};
  const list=await bucket.list({prefix:'private/tebex/payments/',limit:100});
  for(const x of list.objects){
   const p=await read(x.key);
   if(p?.provider!=='tebex'||p.planId!=='week'||!p.date?.startsWith('2026-11-25T00:04:'))continue;
   const id=p.paymentId;
   const marker=await read('private/tebex/processed/'+id+'.json');
   const activity=await read('private/activity/receipts/'+id+'.json');
   const order=await read('private/tebex/orders/'+p.orderRef+'.json');
   const entitlement=await read('private/discord-entitlements/'+p.discordId+'/'+id);
   const invoice=await read('private/invoices/'+p.owner+'/'+id);
   const stock=await paymentLicenseStatus(bucket,p);
   const publicMarker=await read('private/activity/announced/'+id+'.json');
   const target=process.env.BRO_DISCORD_WEBHOOK_WEEK;
   const hook=target?new URL(target).pathname.split('/')[3]:null;
   const staff=hook?await read('private/notifications/confirmed/'+hook+'/'+id+'.json'):null;
   const profile=await readAccount(bucket,p.discordId);
   const visible=await getActivityPreference(bucket,p.discordId);
   let discord=null,publicHook=null;
   if(process.env.BRO_DISCORD_BOT_TOKEN){
    const rr=await fetch('https://discord.com/api/v10/guilds/'+process.env.BRO_DISCORD_GUILD_ID+'/members/'+p.discordId,{headers:{Authorization:'Bot '+process.env.BRO_DISCORD_BOT_TOKEN},signal:AbortSignal.timeout(5000),redirect:'error'});
    const m=rr.ok?await rr.json():null;
    discord={http:rr.status,customer:m?.roles?.includes(process.env.BRO_DISCORD_CUSTOMER_ROLE_ID)??false,lifetime:m?.roles?.includes(process.env.BRO_DISCORD_LIFETIME_ROLE_ID)??false};
   }
   if(process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY){
    try{const u=new URL(process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY);if(u.protocol==='https:'&&u.hostname==='discord.com'&&/^\/api\/webhooks\/\d{17,20}\/[a-zA-Z0-9_-]+$/.test(u.pathname)){
      const rr=await fetch(u.href,{signal:AbortSignal.timeout(5000),redirect:'error'});publicHook={http:rr.status};}else publicHook={valid:false};
    }catch(e){publicHook={error:e.name};}
   }
   console.log('BRO_TEBEX_AUDIT '+JSON.stringify({confirmed:true,plan:p.planId,marker,entitlement:!!entitlement,invoice:!!invoice,activity:!!activity,stock:stock.status,staffReceipt:!!staff,staffReceiptMatches:staff?.deliveryState?.startsWith('assigned:')??false,publicReceipt:!!publicMarker,publicHook,discord,profileFound:!!profile,profileAvatar:!!profile?.avatar,visible,autoPublic:activity?.autoPublic===true,orderVisibility:order?.feedVisibility??null}));
  }
 }catch(e){console.log('BRO_TEBEX_AUDIT_ERROR '+JSON.stringify({type:e.name,frame:String(e.stack??'').split('\n').find(l=>/\/lib\/[a-z-]+\.mjs:\d+:\d+/.test(l))?.match(/\/lib\/[a-z-]+\.mjs:\d+:\d+/)?.[0]}));}
}
