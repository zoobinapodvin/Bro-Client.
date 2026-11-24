import {json} from './store.mjs';
export const HOME_OWNER='1027596385123565569';
export const HOME_KEY='private/content/homepage-v1.json';
export const HOME_FIELDS=Object.freeze({"hero":["eyebrow","title1","title2","text","primary","secondary"],"hero-image":["image"],"sales-heading":["eyebrow","title"],"access-heading":["eyebrow","title","text","cta"],"scope-heading":["eyebrow","title","text"],"club-heading":["eyebrow","title","text"],"faq-heading":["eyebrow","title"],"footer":["text"],"access-1":["title","text","image"],"access-2":["title","text","image"],"access-3":["title","text","image"],"access-4":["title","text","image"],"scope-1":["title","text","image"],"scope-2":["title","text","image"],"scope-3":["title","text","image"],"scope-4":["title","text","image"],"scope-5":["title","text","image"],"scope-6":["title","text","image"],"club-1":["title","text","image"],"club-2":["title","text","image"],"club-3":["title","text","image"],"faq-1":["title","text","image"],"faq-2":["title","text","image"],"faq-3":["title","text","image"],"offer-heading":["title","text"],"offer-access-heading":["eyebrow","title","text"],"offer-access-1":["eyebrow","title","text","item1","item2","image"],"offer-access-2":["eyebrow","title","text","item1","item2","image"],"offer-access-3":["eyebrow","title","text","item1","item2","image"],"offer-guide-heading":["eyebrow","title","text"],"offer-guide-1":["title","text"],"offer-guide-2":["title","text"],"offer-guide-3":["title","text"],"offer-help":["title","text","cta"],"offer-faq-heading":["title"],"offer-cta":["cta"],"offer-plan-day":["title","text","cta","image"],"offer-plan-week":["title","text","cta","image"],"offer-plan-month":["title","text","cta","image"],"offer-plan-life":["title","text","cta","image"],"offer-faq-1":["title","text"],"offer-faq-2":["title","text"],"offer-faq-3":["title","text"],"compat-heading":["title"],"compat-1":["title","text","image"],"compat-2":["title","text","image"]});
export function canEditHomepage(user){return user?.discordId===HOME_OWNER;}
export async function readHomepage(bucket){const record=await bucket.get(HOME_KEY);const data=record?await record.json():null;return {blocks:data?.blocks??{},revision:record?.etag??'initial'};}
const validImage=v=>v===''||/^\/media\/[a-f0-9-]{36}$/.test(v)||/^\/assets\/[a-zA-Z0-9_./-]+\.(webp|png|jpe?g)$/i.test(v)&&!v.includes('..');
export function validHomePatch(id,fields){
 if(!Object.hasOwn(HOME_FIELDS,id)||!fields||typeof fields!=='object'||Array.isArray(fields))return false;
 const keys=Object.keys(fields);return keys.length>0&&keys.every(k=>HOME_FIELDS[id].includes(k)&&typeof fields[k]==='string'&&(k==='image'?validImage(fields[k]):fields[k].trim().length>0&&fields[k].length<=(k==='text'?1600:140)));
}
export async function saveHomepage(bucket,user,revision,patch){
 if(!canEditHomepage(user))return json({error:'Accès propriétaire requis.'},403);
 if(!revision)return json({error:'Recharge le contenu avant de publier.'},428);
 if(!validHomePatch(patch?.id,patch?.fields))return json({error:'Contenu invalide.'},422);
 const previous=await readHomepage(bucket);if(previous.revision!==revision)return json({error:'Une autre publication a modifié cette page. Recharge-la avant de réessayer.'},409);
 const next={...previous.blocks,[patch.id]:{...previous.blocks[patch.id],...patch.fields}};
 const saved=await bucket.put(HOME_KEY,JSON.stringify({blocks:next}),{onlyIf:revision==='initial'?{etagDoesNotMatch:'*'}:{etagMatches:revision}});
 return saved?json({blocks:next,revision:saved.etag}):json({error:'Une autre publication est en cours. Recharge la page.'},409);
}
