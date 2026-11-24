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


 // One-time integration diagnostic: unpaid basket only, no charge, no buyer data.
 if(process.env.VERCEL_ENV==='production' && process.env.TEBEX_PUBLIC_TOKEN){
  const {randomUUID}=await import('node:crypto');
  const token=process.env.TEBEX_PUBLIC_TOKEN.trim();
  const base='https://headless.tebex.io/api';
  const probe=async(stage,path,body)=>{
   const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Accept':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(7000)});
   const j=await r.json().catch(()=>({}));
   const detail=JSON.stringify({message:j.message,title:j.title,detail:j.detail,errors:j.errors}).toLowerCase();
   const kinds=['token','webstore','account','package','quantity','username','auth','ip_address','complete_url','cancel_url','custom','not found','not enabled','not available','required','invalid'];
   console.log('Tebex diagnostic',stage,r.status,kinds.filter(k=>detail.includes(k)).join(','));
   return r.ok?(j.data??j):null;
  };
  try{
   const store=await probe('store','/accounts/'+encodeURIComponent(token));
   if(store){
    for(const id of ['7832046','7832045','7832044','7832042']){
     const p=await probe('package '+id,'/accounts/'+encodeURIComponent(token)+'/packages/'+id);
     if(p)console.log('Tebex catalog match',id,String(p.id)===id);
    }
    const basket=await probe('create','/accounts/'+encodeURIComponent(token)+'/baskets',{complete_url:'https://www.broclient.com/',cancel_url:'https://www.broclient.com/offres',complete_auto_redirect:true,custom:{bro_order:randomUUID()}});
    if(basket?.ident){
     const result=await probe('add','/baskets/'+encodeURIComponent(basket.ident)+'/packages',{package_id:'7832046',quantity:1});
     if(result)console.log('Tebex checkout link returned',Boolean(result.links?.checkout));
    }
   }
  }catch(error){console.log('Tebex diagnostic network error',error?.name);}
 }else console.log('Tebex diagnostic unavailable in build environment');
