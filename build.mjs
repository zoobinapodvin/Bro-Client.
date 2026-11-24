import {spawnSync} from 'node:child_process';
for(const script of ['app.js','api/platform.js','lib/fulfillment.mjs','lib/discord.mjs','lib/purchase-notify.mjs','lib/patchnotes.mjs','patchnotes.js','lib/activity.mjs','lib/checkout.mjs','lib/accounts.mjs','key-stock.js','xlsx-stock.js','lib/customer-guides.mjs','lib/homepage.mjs','homepage-editor.js']){
  const check=spawnSync(process.execPath,['--check',script],{stdio:'inherit'});
  if(check.status!==0)throw Error('JavaScript syntax check failed: '+script);
}
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs','tests/discord-oauth-route.test.mjs','tests/secure-portal.test.mjs','tests/activity-ui.test.mjs','tests/checkout-guest.test.mjs','tests/purchase-feed.test.mjs','tests/patchnotes-notify.test.mjs','tests/accounts.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js','patchnotes.html','patchnotes.js','key-stock.js','key-stock.css','xlsx-stock.js','homepage-editor.js']) await cp(path,'dist/'+path,{recursive:true});

// The old static installation pages are retired. No guide HTML is shipped in dist.
await cp('guides.css','dist/guides.css');


// One-time production smoke test: creates no payment or customer entitlement.
if(process.env.VERCEL_ENV==='production'&&process.env.TEBEX_PUBLIC_TOKEN){
 try{
  const token=process.env.TEBEX_PUBLIC_TOKEN.trim();
  const api='https://headless.tebex.io/api/accounts/'+encodeURIComponent(token);
  const result=await fetch(api+'/baskets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({complete_url:'https://www.broclient.com/',cancel_url:'https://www.broclient.com/offres',custom:{bro_probe:true}}),signal:AbortSignal.timeout(7000)});
  const j=await result.json();
  const basket=j.data??j;
  if(!result.ok||!basket.ident)throw Error('basket_create');
  const auth=await fetch(api+'/baskets/'+encodeURIComponent(basket.ident)+'/auth?returnUrl='+encodeURIComponent('https://www.broclient.com/checkout/day'),{signal:AbortSignal.timeout(7000)});
  const a=await auth.json();
  const providers=a.data??a;
  console.log('Tebex smoke test: auth status',auth.status,'providers',Array.isArray(providers)?providers.map(p=>({name:String(p.name).replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,30),host:new URL(p.url).hostname})):[]);
 }catch(e){console.log('Tebex smoke test unsuccessful',e?.name);}
}
