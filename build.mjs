import {spawnSync} from 'node:child_process';
const checks=spawnSync(process.execPath,['--test','tests/bro-checkout-roles.test.mjs'],{stdio:'inherit'});
if(checks.status!==0)throw Error('Bro Client checks failed. Deployment stopped.');
import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','offres.html','connexion.html','connexion.js','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js']) await cp(path,'dist/'+path,{recursive:true});
