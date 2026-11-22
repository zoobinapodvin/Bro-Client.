import {createHash} from 'node:crypto';

const PREFIX='private/activity/receipts/';
const CONSENT_PREFIX='private/activity/consent/';
const labels={day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'};
const productPlans={
  prod_ZrNuFIODHTxMx:'day',
  prod_m8OHqP9zv7liA:'week',
  prod_tKudM82xNhny0:'month',
  prod_xejMeqvQCPugc:'life'
};
const snippets=[
  'Un nouveau membre rejoint les BRO.',
  'Merci pour la confiance, bienvenue chez BRO.',
  'Un nouvel accès Bro Client vient d’être activé.',
  'La communauté BRO s’agrandit.',
  'Bienvenue à bord, et merci pour le soutien.'
];
const safeUsername=name=>{
 if(typeof name!=='string')return null;
 const s=name.replace(/[\r\n\t@<>]/g,'').trim().slice(0,32);
 return s&&s.length>=2&&!s.includes('@')?s:null;
};
export function safeAvatar(src){
 if(typeof src!=='string'||src.length>350)return null;
 try{
  const u=new URL(src);
  if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))return null;
  if(!/^\/(avatars|embed\/avatars)\//.test(u.pathname))return null;
  return u.origin+u.pathname;
 }catch{return null;}
}
const preferenceKey=discordId=>CONSENT_PREFIX+discordId+'.json';
export async function getActivityPreference(bucket,discordId){
 if(!/^\d{17,20}$/.test(discordId||''))return false;
 const item=await bucket.get(preferenceKey(discordId));
 return item?(await item.json())?.showPublic===true:false;
}
export async function setActivityPreference(bucket,user,consent){
 if(!/^\d{17,20}$/.test(user?.discordId||''))throw Error('discord_identity_required');
 const value=consent===true;
 await bucket.put(preferenceKey(user.discordId),JSON.stringify({showPublic:value,updatedAt:new Date().toISOString()}));
 return {showPublic:value};
}
const safeAmount=v=>{
 const n=Number(v);
 return Number.isFinite(n)&&n>=0&&n<=100000?Math.round(n*100)/100:null;
};
export function normalizePayment(payment,planId,{visible=false,username=null,avatar=null}={}){
 const id=payment?.id;
 const plan=labels[planId];
 const date=payment?.paid_at;
 const amount=safeAmount(payment?.amount_charged?.amount??payment?.total);
 const currency=String(payment?.amount_charged?.currency??payment?.currency??'EUR').toUpperCase();
 const company=payment?.account_id||payment?.company?.id;
 if(!/^pay_[a-zA-Z0-9]+$/.test(id||'')||!plan||!Number.isFinite(Date.parse(date))||
    amount===null||currency!=='EUR'||company!=='biz_emxZArodB6p2Af')return null;
 return {
  paymentId:id,planId,plan,amount,currency:'EUR',date:new Date(date).toISOString(),
  name:visible?safeUsername(username)||'Client BRO':'Client BRO',
  avatar:visible?safeAvatar(avatar):null,
  publicIdentity:visible&&!!safeUsername(username)
 };
}
export async function storeActivity(bucket,record){
 if(!record)return {stored:false};
 const path=PREFIX+record.paymentId+'.json';
 if(await bucket.head(path))return {stored:false,already:true};
 const saved=await bucket.put(path,JSON.stringify(record),{onlyIf:{etagDoesNotMatch:'*'}});
 return {stored:!!saved,already:!saved};
}
export async function recentPurchases(bucket){
 let cursor;const all=[];
 for(let page=0;page<8;page++){
  const result=await bucket.list({prefix:PREFIX,limit:100,cursor});
  for(const item of result.objects){
   if(!item.key.startsWith(PREFIX))continue;
   const content=await bucket.get(item.key);
   if(!content)continue;
   const record=await content.json();
   if(!record||!labels[record.planId]||!Number.isFinite(Date.parse(record.date))||safeAmount(record.amount)===null)continue;
   all.push(record);
  }
  if(!result.truncated||!result.cursor)break;
  cursor=result.cursor;
 }
 return all.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,5).map(({plan,amount,currency,date,name,avatar})=>({
  plan,amount,currency,date,name,avatar:safeAvatar(avatar)
 }));
}
function webhookTarget(url){
 if(!url)return null;
 try{
  const parsed=new URL(url);
  return parsed.protocol==='https:'&&parsed.hostname==='discord.com'&&
    /^\/api\/webhooks\/\d{17,20}\/[a-zA-Z0-9_-]+$/.test(parsed.pathname)?parsed.href:null;
 }catch{return null;}
}
const phraseFor=id=>snippets[createHash('sha256').update(id).digest()[0]%snippets.length];
export async function sendPublicPurchase(bucket,record){
 const endpoint=webhookTarget(process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY);
 if(!endpoint||!record)return {configured:false,ok:false};
 const sent='private/activity/announced/'+record.paymentId+'.json';
 if(await bucket.head(sent))return {configured:true,ok:true,duplicate:true};
 const display=record.publicIdentity?record.name:'Un client';
 const amount=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(record.amount);
 const message={username:'BRO. · Achats',
  content:`**${display}** vient de choisir **${record.plan}** · **${amount}**\n${phraseFor(record.paymentId)}`,
  allowed_mentions:{parse:[]}};
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),
   signal:AbortSignal.timeout(4500),redirect:'error'});
  if(!response.ok)return {configured:true,ok:false};
  await bucket.put(sent,JSON.stringify({sentAt:new Date().toISOString()}),{onlyIf:{etagDoesNotMatch:'*'}});
  return {configured:true,ok:true};
 }catch{return {configured:true,ok:false};}
}
// Admin-only historical import. A previous payment is never used to grant Discord roles or licenses.
export async function backfillWhopHistory(bucket,{apiKey,accountId,maxPages=2}){
 if(!apiKey||accountId!=='biz_emxZArodB6p2Af')return {status:'not_configured',imported:0};
 let cursor,imported=0,reviewed=0;
 for(let page=0;page<Math.min(maxPages,3);page++){
  const endpoint=new URL('https://api.whop.com/api/v1/payments');
  endpoint.searchParams.set('company_id',accountId);
  endpoint.searchParams.set('first','50');
  endpoint.searchParams.set('order','paid_at');
  endpoint.searchParams.set('direction','desc');
  if(cursor)endpoint.searchParams.set('after',cursor);
  const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+apiKey,'Api-Version-Date':'2026-11-20'},
   redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('whop_history_unavailable');
  const data=await response.json();
  if(!Array.isArray(data.data))throw Error('invalid_whop_history');
  for(const payment of data.data){
   reviewed++;
   if(payment.status!=='paid'||payment.refunded_at||payment.auto_refunded||payment.substatus==='refunded')continue;
   const planId=productPlans[payment.product?.id];
   if(!planId)continue;
   const record=normalizePayment(payment,planId); // Historical identities must remain private.
   if(record){const result=await storeActivity(bucket,record);if(result.stored)imported++;}
  }
  if(!data.page_info?.has_next_page||!data.page_info?.end_cursor)break;
  cursor=data.page_info.end_cursor;
 }
 return {status:'ok',reviewed,imported};
}
