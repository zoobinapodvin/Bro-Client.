import {createHash} from 'node:crypto';
import {safeAvatar} from './activity.mjs';
const prefix='private/bro-accounts/v1/';
const handles='private/bro-handles/v1/';
const snowflake=id=>typeof id==='string'&&/^\d{17,20}$/.test(id);
const hash=id=>createHash('sha256').update(id).digest('hex');
const path=id=>prefix+id+'.json';
const handlePattern=/^[a-z0-9][a-z0-9_-]{1,31}$/;
const cleanName=name=>typeof name==='string'&&!name.includes('@')?name.replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,32):'Compte Discord';
const slug=name=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,14)||'bro';
export async function readAccount(bucket,id){
 if(!snowflake(id))return null;
 const entry=await bucket.get(path(id));return entry?await entry.json():null;
}
export async function registerAccount(bucket,user,now=Date.now()){
 if(!snowflake(user?.discordId)||typeof user.id!=='string'||!user.id)return null;
 const id=user.discordId, name=cleanName(user.discordUsername)||'Compte Discord', avatar=safeAvatar(user.discordAvatar);
 const timestamp=new Date(now).toISOString();
 for(let retry=0;retry<3;retry++){
  const entry=await bucket.get(path(id)), prior=entry?await entry.json():null;
  if(prior){
   // An existing Discord identity is not reassigned to a different Auth user.
   if(prior.authId!==user.id)throw Error('account_identity_conflict');
   if(prior.displayName===name&&prior.avatar===avatar&&now-Date.parse(prior.lastSeenAt)<600000)return prior;
   const next={...prior,displayName:name,avatar,lastSeenAt:timestamp};
   if(await bucket.put(path(id),JSON.stringify(next),{onlyIf:{etagMatches:entry.etag}}))return next;
   continue;
  }
  for(let n=16;n<=28;n+=4){
   const handle=slug(name).slice(0,31-n)+'-'+hash(id).slice(0,n);
   const index=handles+handle+'.json';
   const reserved=await bucket.put(index,JSON.stringify({discordId:id}),{onlyIf:{etagDoesNotMatch:'*'}});
   if(!reserved){const old=await bucket.get(index);if(!old||(await old.json()).discordId!==id)continue;}
   const record={authId:user.id,discordId:id,username:handle,displayName:name,avatar,createdAt:timestamp,lastSeenAt:timestamp};
   if(await bucket.put(path(id),JSON.stringify(record),{onlyIf:{etagDoesNotMatch:'*'}}))return record;
   break;
  }
 }
 throw Error('account_registry_conflict');
}
export async function findAccount(bucket,query){
 if(typeof query!=='string')return null;
 const normalized=query.trim().toLowerCase();
 if(snowflake(normalized))return readAccount(bucket,normalized);
 if(!handlePattern.test(normalized))return null;
 const item=await bucket.get(handles+normalized+'.json');
 if(!item)return null;
 const record=await readAccount(bucket,(await item.json()).discordId);
 return record?.username===normalized?record:null;
}
export async function listAccounts(bucket,cursor){
 const page=await bucket.list({prefix,limit:25,cursor:cursor||undefined});
 const accounts=(await Promise.all(page.objects.filter(x=>x.key.startsWith(prefix)).map(async x=>{
  const id=x.key.slice(prefix.length).replace(/\.json$/,'');return readAccount(bucket,id);
 }))).filter(Boolean).map(({username,displayName,discordId,createdAt,lastSeenAt})=>({username,displayName,discordId,createdAt,lastSeenAt}));
 return {accounts,nextCursor:page.truncated?page.cursor:null};
}
