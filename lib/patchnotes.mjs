const STORAGE='private/patchnotes/catalogue.json';
export const PATCHNOTE_EDITOR_DISCORD_ID='1027596385123565569';
export const canEditPatchnotes=user=>user?.discordId===PATCHNOTE_EDITOR_DISCORD_ID;
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const validId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{1,110}$/.test(id);
async function load(bucket){
 const blob=await bucket.get(STORAGE);
 if(!blob)return {items:[],revision:'initial'};
 const data=await blob.json();
 return {items:Array.isArray(data.items)?data.items:[],revision:blob.etag};
}
export async function listPatchnotes(bucket,{admin=false}={}){
 const {items}=await load(bucket);
 return items.filter(item=>admin||item.status==='published')
   .sort((a,b)=>Date.parse(b.publishedAt??b.updatedAt)-Date.parse(a.publishedAt??a.updatedAt))
   .map(({id,title,version,summary,status,publishedAt,updatedAt})=>
     ({id,title,version,summary,status,publishedAt,updatedAt}));
}
export async function readPatchnote(bucket,id,{admin=false}={}){
 if(!validId(id))return null;
 const {items}=await load(bucket);
 return items.find(item=>item.id===id&&(admin||item.status==='published'))??null;
}
export async function editPatchnote(bucket,request){
 // Retry catalogue-level write conflicts without overwriting a concurrently edited note.
 for(let attempt=0;attempt<3;attempt++){
  const result=await editPatchnoteOnce(bucket,request);
  if(!result.retryable)return result;
 }
 return {status:409,error:'Une autre modification est en cours. Réessaie dans un instant.'};
}
async function editPatchnoteOnce(bucket,request){
 if(!request||typeof request!=='object')return {status:422,error:'Données invalides.'};
 const {items,revision}=await load(bucket);
 const action=request.action||'create';
 if(!['create','update','delete'].includes(action))return {status:422,error:'Action inconnue.'};
 if(action!=='create'&&request.expectedUpdatedAt!==undefined){
  const previous=items.find(item=>item.id===request.id);
  if(previous&&previous.updatedAt!==request.expectedUpdatedAt)return {status:409,error:'Cette mise à jour a été modifiée depuis son ouverture. Recharge la page avant de continuer.'};
 }
 if(items.length>=80&&action==='create')return {status:409,error:'Limite de publications atteinte.'};
 if(action==='delete'){
  if(!validId(request.id)||!items.some(item=>item.id===request.id))return {status:404,error:'Patchnote introuvable.'};
  const remaining=items.filter(item=>item.id!==request.id);
  const saved=await bucket.put(STORAGE,JSON.stringify({items:remaining}),{
   onlyIf:revision==='initial'?{etagDoesNotMatch:'*'}:{etagMatches:revision}});
  return saved?{status:200,deleted:true}:{status:409,retryable:typeof request.expectedUpdatedAt==='string',error:'Contenu modifié : recharge la page.'};
 }
 const title=clean(request.title,90);
 const version=clean(request.version,40);
 const summary=clean(request.summary,230);
 const content=typeof request.content==='string'?request.content.replace(/\r/g,'').trim().slice(0,14000):'';
 const status=request.publish===true?'published':'draft';
 if(title.length<5||!version||summary.length<10||content.length<20)
  return {status:422,error:'Complète le titre, la version, le résumé et le contenu (20 caractères minimum).'};
 let index=-1;
 if(action==='update'){
  if(!validId(request.id))return {status:422,error:'Identifiant incorrect.'};
  index=items.findIndex(item=>item.id===request.id);
  if(index<0)return {status:404,error:'Patchnote introuvable.'};
 }
 const now=new Date().toISOString();
 const previous=index>=0?items[index]:null;
 const id=previous?.id??(version.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'mise-a-jour')+'-'+crypto.randomUUID().slice(0,8);
 const record={id,title,version,summary,content,status,createdAt:previous?.createdAt??now,
  updatedAt:now,publishedAt:status==='published'?(previous?.publishedAt??now):null};
 if(index>=0)items[index]=record;else items.unshift(record);
 const saved=await bucket.put(STORAGE,JSON.stringify({items}),{
  onlyIf:revision==='initial'?{etagDoesNotMatch:'*'}:{etagMatches:revision}});
 return saved?{status:200,item:record}:{status:409,retryable:action==='create'||typeof request.expectedUpdatedAt==='string',error:'Une autre modification est intervenue. Recharge la page.'};
}
