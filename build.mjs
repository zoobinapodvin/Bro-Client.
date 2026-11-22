import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','connexion.html','connexion.js','app.js','style.css','assets','defaults.json','manifest.webmanifest','informations.html','informations.js']) await cp(path,'dist/'+path,{recursive:true});
