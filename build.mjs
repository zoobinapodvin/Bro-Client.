import {spawnSync} from 'node:child_process';
for(const script of ['app.js','api/platform.js','lib/fulfillment.mjs','lib/purchase-receipt.mjs','lib/discord.mjs','lib/purchase-notify.mjs','lib/patchnotes.mjs','patchnotes.js','lib/activity.mjs','lib/checkout.mjs','lib/tebex.mjs','lib/accounts.mjs','key-stock.js','xlsx-stock.js','lib/customer-guides.mjs','lib/homepage.mjs','homepage-editor.js','status.js','lib/service-status.mjs']){
  const check=spawnSync(process.execPath,['--check',script],{stdio:'inherit'});
  if(check.status!==0)throw Error('JavaScript syntax check failed: '+script);
}
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs','tests/discord-oauth-route.test.mjs','tests/secure-portal.test.mjs','tests/activity-ui.test.mjs','tests/checkout-guest.test.mjs','tests/purchase-feed.test.mjs','tests/patchnotes-notify.test.mjs','tests/accounts.test.mjs','tests/tebex.test.mjs','tests/purchase-receipt.test.mjs','tests/service-status.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','espace-client.html','account.css','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js','patchnotes.html','patchnotes.js','key-stock.js','key-stock.css','xlsx-stock.js','homepage-editor.js','status.html','status.css','status.js']) await cp(path,'dist/'+path,{recursive:true});

// The old static installation pages are retired. No guide HTML is shipped in dist.
await cp('guides.css','dist/guides.css');


// Seed the owner's explicitly declared operational state once; subsequent deployments preserve it.
if(process.env.VERCEL_ENV==='production'){const {bucket}=await import('./lib/storage.mjs');const {initializeManualStatus}=await import('./lib/service-status.mjs');const result=await initializeManualStatus(bucket);console.info('BRO manual status initialization',JSON.stringify({state:result.state,discord:result.discord,already:result.already,busy:result.busy}));}

// Apply the official BRO avatar to the webhook profile once for this visual upgrade.
if(process.env.VERCEL_ENV==='production'){
 try{
  const {readFile}=await import('node:fs/promises');
  const {bucket}=await import('./lib/storage.mjs');
  const {updateStatusWebhookProfile,syncServiceStatus,ensureStatusMessageAvatar}=await import('./lib/service-status.mjs');
  const profile=await updateStatusWebhookProfile(await readFile('assets/bro-192.png'));
  const result=await syncServiceStatus(bucket);
  const avatarCheck=profile.ok?await ensureStatusMessageAvatar(bucket,profile.avatar):{ok:false};
  console.info('BRO existing Discord avatar check',JSON.stringify(avatarCheck));
  console.info('BRO multi-service Discord upgrade',JSON.stringify({avatar:profile.ok,avatarHttp:profile.status,discord:result.discord,busy:result.busy,state:result.state,existingMessageAvatar:typeof result.authorAvatar==='string'&&result.authorAvatar.length>0,avatarMatches:!!profile.avatar&&profile.avatar===result.authorAvatar}));
 }catch(error){console.warn('BRO Discord upgrade deferred',error?.name);}
}
