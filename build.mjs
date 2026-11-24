import {spawnSync} from 'node:child_process';
for(const script of ['app.js','api/platform.js','lib/fulfillment.mjs','lib/discord.mjs','lib/purchase-notify.mjs','lib/patchnotes.mjs','patchnotes.js','lib/activity.mjs','lib/checkout.mjs']){
  const check=spawnSync(process.execPath,['--check',script],{stdio:'inherit'});
  if(check.status!==0)throw Error('JavaScript syntax check failed: '+script);
}
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs','tests/discord-oauth-route.test.mjs','tests/secure-portal.test.mjs','tests/activity-ui.test.mjs','tests/checkout-guest.test.mjs','tests/purchase-feed.test.mjs','tests/patchnotes-notify.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js','patchnotes.html','patchnotes.js']) await cp(path,'dist/'+path,{recursive:true});

const {readFile,writeFile}=await import('node:fs/promises');
const home=await readFile('dist/index.html','utf8');
const guidePage=home.replace(/<main\b[\s\S]*?<\/main>/,'<main id="main" class="shell"><article id="guide-catalogue"><a href="/#compte">← Espace client</a><h1>Guides</h1><section aria-live="polite"></section></article></main>')
 .replace(/<title>[^<]*<\/title>/,'<title>Guides · Bro Client</title>')
 .replaceAll('href="#accueil"','href="/#accueil"').replaceAll('href="#fonctionnalites"','href="/#fonctionnalites"').replaceAll('href="#faq"','href="/#faq"').replace(' aria-current="page"','');
await writeFile('dist/guides.html',guidePage);
