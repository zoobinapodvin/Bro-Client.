import {deflateSync} from 'node:zlib';
const PATH='private/service-status/rob-run-v1.json',LOCK=PATH+'.lease';
const LABELS={UNDETECTED:'available',ACTIVE:'available',UPDATING:'paused',PAUSED:'paused',RISKY:'unavailable',DETECTED:'unavailable','COMING SOON':'unavailable',COMING_SOON:'unavailable',UNKNOWN:'unknown'};
const descriptions={available:'Disponible selon le fournisseur',paused:'En pause / mise à jour',unavailable:'Indisponible selon le fournisseur',unknown:'Non vérifié'};
const palette={available:[107,203,168],paused:[226,189,121],unavailable:[237,147,153],unknown:[70,86,105]};
const normal=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,' ');
export function normalizeProviderStatus(value){const label=normal(value);return {state:LABELS[label]||'unknown',label:Object.hasOwn(LABELS,label)?label:'UNKNOWN'};}
export function parseProviderApi(data){
 if(data?.ok!==true||!Array.isArray(data.products))return null;
 const rows=data.products.filter(p=>[p.name,p.game,p.slug].some(x=>typeof x==='string'&&/^rob[ -]?run$/i.test(x.trim())));
 if(rows.length!==1)return null;
 return normalizeProviderStatus(rows[0].status);
}
// Only accept an explicit product link and an immediately associated status token.
// Never infer availability from other products or historical change rows.
export function parseProviderPage(html){
 if(typeof html!=='string'||html.length>3000000)return null;
 const found=[];
 for(const m of html.matchAll(/<a\b[^>]*href=["'][^"']*rob-run[^"']*["'][^>]*>([\s\S]{0,1200}?)<\/a>/gi)){
  const name=m[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(!/^rob run$/i.test(name))continue;
  const tail=html.slice(m.index+m[0].length,m.index+m[0].length+1400).split(/<a\b|Recent status changes|Derniers changements|<\/article>|<\/li>/i)[0];
  const raw=tail.match(/>\s*(UNDETECTED|ACTIVE|UPDATING|PAUSED|RISKY|DETECTED|COMING SOON|UNKNOWN)\s*</i);
  if(raw)found.push(normalizeProviderStatus(raw[1]));
 }
 return found.length&&found.every(x=>x.label===found[0].label)?found[0]:null;
}
export async function checkProvider(fetcher=fetch){
 const key=process.env.STRATX_RESELLER_API_KEY;
 if(key)try{
  const r=await fetcher('https://stratx.ac/api/reseller/status',{headers:{Authorization:'Bearer '+key,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(r.ok){const parsed=parseProviderApi(await r.json());if(parsed)return {...parsed,source:'api'};}
 }catch{}
 try{const r=await fetcher('https://stratx.ac/status',{headers:{Accept:'text/html'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});if(r.ok){const parsed=parseProviderPage(await r.text());if(parsed)return {...parsed,source:'public'};}}catch{}
 return {state:'unknown',label:'UNKNOWN',source:'unverified'};
}
const read=async(bucket,path)=>{const e=await bucket.get(path);return e?await e.json():null;};
const rank={unknown:0,available:1,paused:2,unavailable:3};
export function publicStatus(record,now=Date.now()){
 const checkedAt=record?.checkedAt||null,age=now-Date.parse(checkedAt||'');
 const fresh=Number.isFinite(age)&&age>=0&&age<=12*60000;
 const state=fresh&&Object.hasOwn(rank,record?.state)?record.state:'unknown';
 const hours=Array(24).fill('unknown'),hour=Math.floor(now/3600000);
 for(const p of (record?.history||[])){const i=Math.floor(Date.parse(p.at)/3600000)-hour+23;if(i>=0&&i<24&&Object.hasOwn(rank,p.state)&&rank[p.state]>rank[hours[i]])hours[i]=p.state;}
 return {state,label:fresh?record?.label||'UNKNOWN':'UNKNOWN',checkedAt,source:fresh?record?.source||'unverified':'unverified',hours};
}
export async function readPublicStatus(bucket){return publicStatus(await read(bucket,PATH));}
function crc(b){let c=0xffffffff;for(const x of b){c^=x;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),end=Buffer.alloc(4);len.writeUInt32BE(data.length);end.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,end]);}
const font={A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],D:[30,17,17,17,17,17,30],E:[31,16,16,30,16,16,31],F:[31,16,16,30,16,16,16],G:[14,17,16,23,17,17,14],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],J:[7,2,2,2,18,18,12],K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],M:[17,27,21,21,17,17,17],N:[17,25,21,19,17,17,17],O:[14,17,17,17,17,17,14],P:[30,17,17,30,16,16,16],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],U:[17,17,17,17,17,17,14],V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,27,17],X:[17,17,10,4,10,17,17],Y:[17,17,10,4,4,4,4],Z:[31,1,2,4,8,16,31],'0':[14,17,19,21,25,17,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,2,4,8,31],'3':[30,1,1,14,1,1,30],'4':[2,6,10,18,31,2,2],'5':[31,16,16,30,1,1,30],'6':[14,16,16,30,17,17,14],'7':[31,1,2,4,8,8,8],'8':[14,17,17,14,17,17,14],'9':[14,17,17,15,1,1,14],'.':[0,0,0,0,0,12,12],'-':[0,0,0,31,0,0,0],':':[0,12,12,0,12,12,0]};
export function statusPng(data){
 const w=760,h=230,raw=Buffer.alloc((w*3+1)*h);
 const rect=(x,y,ww,hh,c)=>{for(let yy=y;yy<Math.min(h,y+hh);yy++)for(let xx=x;xx<Math.min(w,x+ww);xx++){const i=yy*(w*3+1)+1+xx*3;raw[i]=c[0];raw[i+1]=c[1];raw[i+2]=c[2];}};
 const text=(s,x,y,scale,c)=>{for(const ch of s.toUpperCase()){const bits=font[ch]||[];bits.forEach((row,j)=>{for(let k=0;k<5;k++)if(row&(1<<(4-k)))rect(x+k*scale,y+j*scale,scale,scale,c);});x+=6*scale;}};
 const fg=[229,237,247],muted=[156,174,196];rect(0,0,w,h,[14,21,32]);rect(20,65,720,125,[25,37,51]);rect(20,65,720,1,[57,77,99]);text('BRO. - SERVICE STATUS',24,24,3,fg);
 text('CLIENT ROB RUN',36,83,2,fg);const st={available:'AVAILABLE',paused:'PAUSED',unavailable:'UNAVAILABLE',unknown:'UNVERIFIED'}[data.state]||'UNVERIFIED';text(st,590,85,1,palette[data.state]||palette.unknown);
 data.hours.forEach((s,i)=>rect(36+i*29,115,25,25,palette[s]||palette.unknown));text('24H AGO',36,150,1,muted);text('NOW',694,150,1,muted);
 const count=data.hours.filter(x=>x!=='unknown').length;text(count+' OF 24 HOURS VERIFIED',36,171,1,muted);text('GRAY - NO VERIFIED DATA',24,207,1,muted);
 const head=Buffer.alloc(13);head.writeUInt32BE(w,0);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function discordPayload(data){return {username:'BRO - Status',allowed_mentions:{parse:[]},embeds:[{title:'BRO - Status',url:'https://www.broclient.com/status',color:parseInt(({available:'6bcba8',paused:'e2bd79',unavailable:'ed9399',unknown:'9ca9bb'})[data.state]||'9ca9bb',16),description:'**Client Rob Run**\n'+descriptions[data.state]+'\n\n'+(data.state==='unknown'?'Le statut du fournisseur n’a pas pu être vérifié.':'Statut déclaré : '+data.label+'.')+'\n\nHistorique des 24 dernières heures : '+data.hours.filter(x=>x!=='unknown').length+'/24 h vérifiées.',image:{url:'attachment://bro-status.png'},footer:{text:'BRO CLIENT · Statut déclaré, aucune garantie d’absence de risque'},timestamp:data.checkedAt||new Date().toISOString()}],attachments:[{id:0,filename:'bro-status.png'}]};}
async function publish(data,previous,fetcher){
 const hook=process.env.BRO_STATUS_DISCORD_WEBHOOK;
 if(!hook||!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(hook))return {ok:false,id:previous||null};
 const send=async(id)=>{const body=new FormData();body.append('payload_json',JSON.stringify(discordPayload(data)));body.append('files[0]',new Blob([statusPng(data)],{type:'image/png'}),'bro-status.png');return fetcher(hook+(id?'/messages/'+id:'?wait=true'),{method:id?'PATCH':'POST',body,redirect:'error',signal:AbortSignal.timeout(12000)});};
 try{let r=await send(previous);if(previous&&r.status===404){const error=await r.json().catch(()=>null);if(error?.code!==10008)return {ok:false,id:previous,status:r.status};r=await send(null);}if(!r.ok)return {ok:false,id:previous||null,status:r.status};const m=await r.json();return {ok:/^\d{17,20}$/.test(m.id||''),id:/^\d{17,20}$/.test(m.id||'')?m.id:previous||null};}catch{return {ok:false,id:previous||null};}
}
export async function syncServiceStatus(bucket,{fetcher=fetch}={}){
 const l=await bucket.get(LOCK,{forWrite:true}),old=l?await l.json():null;
 if(old?.until>Date.now())return {busy:true};
 if(!await bucket.put(LOCK,JSON.stringify({until:Date.now()+90000}),{onlyIf:l?{etagMatches:l.etag}:{etagDoesNotMatch:'*'}}))return {busy:true};
 const prev=await read(bucket,PATH),checkedAt=new Date().toISOString(),check=await checkProvider(fetcher);
 const history=[...(prev?.history||[]).filter(x=>Date.parse(x.at)>=Date.now()-25*3600000),{at:checkedAt,state:check.state}].slice(-400);
 const next={...check,checkedAt,history,messageId:prev?.messageId||null};
 await bucket.put(PATH,JSON.stringify(next));
 const result=await publish(publicStatus(next),next.messageId,fetcher);
 if(result.id&&result.id!==next.messageId)await bucket.put(PATH,JSON.stringify({...next,messageId:result.id}));
 return {state:check.state,source:check.source,discord:result.ok,discordHttp:result.status||null};
}
