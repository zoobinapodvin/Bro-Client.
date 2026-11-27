import {deflateSync} from 'node:zlib';
const PATH='private/service-status/rob-run-v1.json',LOCK=PATH+'.lease';
const OWNER='1027596385123565569';
const labels={available:'Opérationnel',maintenance:'Maintenance',degraded:'Perturbations',paused:'En pause',unavailable:'Hors ligne',unknown:'Non renseigné'};
const palette={available:[107,203,168],maintenance:[224,183,103],degraded:[232,155,94],paused:[141,159,204],unavailable:[237,125,138],unknown:[61,76,94]};
const severity={unknown:0,available:1,paused:2,maintenance:3,degraded:4,unavailable:5};
const valid=s=>typeof s==='string'&&Object.hasOwn(labels,s)&&s!=='unknown';
export function canManageStatus(user){return user?.discordId===OWNER;}
const read=async(bucket,path)=>{const e=await bucket.get(path);return e?await e.json():null;};
export function publicStatus(record,now=Date.now()){
 const manual=record?.mode==='manual'&&valid(record.state)&&Number.isFinite(Date.parse(record.changedAt));
 const changes=manual?(record.changes||[]).filter(x=>valid(x.state)&&Number.isFinite(Date.parse(x.at))&&Date.parse(x.at)<=now).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)):[];
 const hours=Array(24).fill('unknown'),hour=Math.floor(now/3600000);
 for(let i=0;i<24;i++){
  const start=(hour-23+i)*3600000,end=Math.min(start+3600000,now+1);
  for(let j=0;j<changes.length;j++){
   const from=Date.parse(changes[j].at),to=j+1<changes.length?Date.parse(changes[j+1].at):now+1;
   if(from<end&&to>start&&to>from&&severity[changes[j].state]>severity[hours[i]])hours[i]=changes[j].state;
  }
 }
 return {state:manual?record.state:'unknown',label:manual?labels[record.state]:labels.unknown,changedAt:manual?record.changedAt:null,note:manual?record.note||'':'',hours};
}
export async function readPublicStatus(bucket){return publicStatus(await read(bucket,PATH));}
function crc(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),end=Buffer.alloc(4);len.writeUInt32BE(data.length);end.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,end]);}
// A clean, high-resolution timeline. All typography is native Discord text.
export function statusPng(data){
 const w=1000,h=116,raw=Buffer.alloc((w*3+1)*h);
 function rect(x,y,ww,hh,r,c){for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+ww;xx++){const dx=Math.max(x+r-xx,0,xx-(x+ww-r-1)),dy=Math.max(y+r-yy,0,yy-(y+hh-r-1));if(dx*dx+dy*dy>r*r)continue;const i=yy*(w*3+1)+1+xx*3;raw[i]=c[0];raw[i+1]=c[1];raw[i+2]=c[2];}}
 rect(0,0,w,h,0,[17,21,27]);rect(12,12,976,92,13,[29,39,52]);
 const colors=data.hours||Array(24).fill('unknown');
 colors.forEach((s,i)=>rect(28+i*40,29,33,58,6,palette[s]||palette.unknown));
 const head=Buffer.alloc(13);head.writeUInt32BE(w,0);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const emojis={available:'🟢',maintenance:'🟡',degraded:'🟠',paused:'🔵',unavailable:'🔴',unknown:'⚪'};
const escapeDiscord=s=>String(s||'').replace(/[\\*_~|\x60<>]/g,'\\$&').replace(/@/g,'＠');
export function discordPayload(data){
 const state=Object.hasOwn(labels,data.state)?data.state:'unknown',changed=Date.parse(data.changedAt||'');
 const description='**Client Rob Run**\n'+emojis[state]+' **'+labels[state]+'**'+(data.note?'\n'+escapeDiscord(data.note):'')+'\n\n**Historique · 24 heures**\nStatuts déclarés par l’équipe BRO.';
 return {username:'BRO - Status',avatar_url:'https://www.broclient.com/assets/bro-192.png',allowed_mentions:{parse:[]},embeds:[{title:'BRO - Status',url:'https://www.broclient.com/status',color:palette[state].reduce((a,b)=>(a<<8)+b,0),description,thumbnail:{url:'https://www.broclient.com/assets/robrunkey.webp'},image:{url:'attachment://bro-status.png'},fields:[{name:'Il y a 24 h → Maintenant',value:'🟢 Opérationnel · 🟡 Maintenance · 🟠 Perturbations\n🔵 En pause · 🔴 Hors ligne · ⚪ Non renseigné'}],footer:{text:'BRO CLIENT · Dernier changement de statut'},...(Number.isFinite(changed)?{timestamp:new Date(changed).toISOString()}:{})}],attachments:[{id:0,filename:'bro-status.png'}]};
}
async function publish(data,previous,fetcher){
 const hook=process.env.BRO_STATUS_DISCORD_WEBHOOK;
 if(!hook||!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(hook))return {ok:false,id:previous||null};
 const send=async(id)=>{const body=new FormData();body.append('payload_json',JSON.stringify(discordPayload(data)));body.append('files[0]',new Blob([statusPng(data)],{type:'image/png'}),'bro-status.png');return fetcher(hook+(id?'/messages/'+id:'?wait=true'),{method:id?'PATCH':'POST',body,redirect:'error',signal:AbortSignal.timeout(12000)});};
 try{let r=await send(previous);if(previous&&r.status===404){const error=await r.json().catch(()=>null);if(error?.code!==10008)return {ok:false,id:previous,status:r.status};r=await send(null);}if(!r.ok)return {ok:false,id:previous||null,status:r.status};const m=await r.json();return {ok:/^\d{17,20}$/.test(m.id||''),id:/^\d{17,20}$/.test(m.id||'')?m.id:previous||null};}catch{return {ok:false,id:previous||null};}
}

async function withLease(bucket,fn){
 const l=await bucket.get(LOCK,{forWrite:true}),old=l?await l.json():null;
 if(old?.until>Date.now())return {busy:true};
 const lease=await bucket.put(LOCK,JSON.stringify({until:Date.now()+90000}),{onlyIf:l?{etagMatches:l.etag}:{etagDoesNotMatch:'*'}});
 if(!lease)return {busy:true};
 try{return await fn();}finally{
  if(lease.etag)try{await bucket.put(LOCK,JSON.stringify({until:0}),{onlyIf:{etagMatches:lease.etag}});}catch{}
 }
}
async function sendCurrent(bucket,next,fetcher){
 const result=await publish(publicStatus(next),next.messageId,fetcher);
 if(result.id&&result.id!==next.messageId)await bucket.put(PATH,JSON.stringify({...next,messageId:result.id}));
 return {state:next.state,discord:result.ok,discordHttp:result.status||null,data:publicStatus(next)};
}
function nextRecord(prev,state,note,now){
 const at=new Date(now).toISOString(),manual=prev?.mode==='manual'&&valid(prev.state);
 const changes=manual?(prev.changes||[]).filter(x=>valid(x.state)&&Number.isFinite(Date.parse(x.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)):[];
 if(!manual||prev.state!==state||prev.note!==note)changes.push({at,state});
 const cutoff=now-25*3600000;
 const older=changes.filter(x=>Date.parse(x.at)<cutoff).at(-1);
 return {mode:'manual',state,note,changedAt:manual&&prev.state===state&&prev.note===note?prev.changedAt:at,changes:[...(older?[older]:[]),...changes.filter(x=>Date.parse(x.at)>=cutoff)],messageId:prev?.messageId||null};
}
export async function setManualStatus(bucket,user,input,{fetcher=fetch,now=Date.now()}={}){
 if(!canManageStatus(user))return {forbidden:true};
 if(!valid(input?.state)||typeof input.note!=='string'||input.note.length>240||/[\x00-\x08\x0b-\x1f]/.test(input.note))return {invalid:true};
 return withLease(bucket,async()=>{
  const prev=await read(bucket,PATH),next=nextRecord(prev,input.state,input.note.trim(),now);
  await bucket.put(PATH,JSON.stringify(next));return sendCurrent(bucket,next,fetcher);
 });
}
export async function initializeManualStatus(bucket,{fetcher=fetch,now=Date.now()}={}){
 return withLease(bucket,async()=>{
  const prev=await read(bucket,PATH);
  if(prev?.mode==='manual')return {already:true};
  const next=nextRecord(prev,'available','',now);
  await bucket.put(PATH,JSON.stringify(next));return sendCurrent(bucket,next,fetcher);
 });
}
export async function syncServiceStatus(bucket,{fetcher=fetch}={}){
 return withLease(bucket,async()=>{
  const prev=await read(bucket,PATH);
  if(prev?.mode!=='manual'||!valid(prev.state))return {state:'unknown',discord:false};
  return sendCurrent(bucket,prev,fetcher);
 });
}
