import {spawnSync} from 'node:child_process';
for(const script of ['app.js','connexion.js','api/platform.js','lib/fulfillment.mjs','lib/discord.mjs','lib/purchase-notify.mjs','lib/activity.mjs','lib/checkout.mjs']){
  const check=spawnSync(process.execPath,['--check',script],{stdio:'inherit'});
  if(check.status!==0)throw Error('JavaScript syntax check failed: '+script);
}
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs','tests/discord-oauth-route.test.mjs','tests/secure-portal.test.mjs','tests/activity-ui.test.mjs','tests/checkout-guest.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','connexion.html','connexion.js','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js']) await cp(path,'dist/'+path,{recursive:true});
