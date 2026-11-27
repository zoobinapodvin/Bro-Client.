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
