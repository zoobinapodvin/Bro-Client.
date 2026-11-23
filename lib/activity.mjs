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
const checkoutPlans={
  plan_MCtWYReKKKb9m:'day',
  plan_kPcl5mzGmRq2Q:'week',
  plan_iN2Oc79WLycrs:'month',
  plan_p90wN1m6OLoEH:'life'
};
export const planForProduct=id=>productPlans[id]??null;
export const planForCheckout=id=>checkoutPlans[id]??null;
const snippets=[
  'Un nouveau membre rejoint les BRO.',
  'Merci pour la confiance, bienvenue chez BRO.',
  'Un nouvel accès Bro Client vient d’être activé.',
  'La communauté BRO s’agrandit.',
  'Bienvenue à bord, et merci pour le soutien.'
];
const safeUsername=name=>{
 if(typeof name!=='string')return null;
 if(name.includes('@'))return null;
 const s=name.replace(/[\r\n\t<>]/g,'').trim().slice(0,32);
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
 if(!value){
   let cursor;
   for(let page=0;page<6;page++){
     const result=await bucket.list({prefix:PREFIX,limit:100,cursor});
     for(const entry of result.objects){
       const blob=await bucket.get(entry.key);
       if(!blob)continue;
       const record=await blob.json();
       if(record.discordId!==user.discordId)continue;
       record.name='Client BRO';record.avatar=null;record.publicIdentity=false;
       delete record.discordId;
       await bucket.put(entry.key,JSON.stringify(record));
     }
     if(!result.truncated||!result.cursor)break;
     cursor=result.cursor;
   }
 }
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
 const company=payment?.account_id||payment?.company?.id||payment?.company_id;
 if((payment?.status && payment.status!=='paid') || !payment?.paid_at || payment?.refunded_at || payment?.auto_refunded || Number(payment?.refunded_amount||0)>0 || payment?.substatus==='refunded')return null;
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
 const skipped={notPaid:0,otherProduct:0,invalid:0,existing:0,otherCompany:0};
 for(let page=0;page<Math.min(maxPages,3);page++){
  // Whop pins the API version to the key when this optional header is omitted.
  // Previously the forced date returned HTTP 400 on every history request.
  const headers={Authorization:'Bearer '+apiKey,Accept:'application/json'};
  const candidates=[
   {company:true,sort:true},
   {company:true,sort:false},
   {company:false,sort:false}
  ];
  let response,scopedByCompany=false;
  for(const option of candidates){
   const endpoint=new URL('https://api.whop.com/api/v1/payments');
   endpoint.searchParams.set('first','50');
   if(option.company)endpoint.searchParams.set('company_id',accountId);
   if(option.sort){endpoint.searchParams.set('order','paid_at');endpoint.searchParams.set('direction','desc');}
   if(cursor)endpoint.searchParams.set('after',cursor);
   response=await fetch(endpoint,{headers,redirect:'error',signal:AbortSignal.timeout(8000)});
   scopedByCompany=option.company;
   if(response.status!==400)break;
  }
  if(!response.ok){
   let reason={};
   try{
    const body=await response.json();
    // Never log a token or a buyer record. Error codes and parameter names only.
    reason={code:String(body?.error?.code??body?.error?.type??'unknown').slice(0,60),
      param:String(body?.error?.param??'none').slice(0,60)};
   }catch{}
   console.error('Whop payments list failed',{status:response.status,...reason});
   throw Error('whop_history_unavailable_'+response.status);
  }
  const data=await response.json();
  if(!Array.isArray(data.data))throw Error('invalid_whop_history');
  for(const payment of data.data){
   reviewed++;
   // paid_at confirms an actual payment. Never include pending, reversed,
   // refunded or unrelated business transactions.
   if((payment.status&&payment.status!=='paid')||!payment.paid_at||
      payment.refunded_at||payment.auto_refunded||Number(payment.refunded_amount||0)>0||
      payment.substatus==='refunded'){skipped.notPaid++;continue;}
   const planId=planForProduct(payment.product?.id??payment.product_id)
     ??planForCheckout(payment.plan?.id??payment.plan_id);
   if(!planId){skipped.otherProduct++;continue;}
   const actualCompany=payment.account_id??payment.company?.id??payment.company_id;
   if(actualCompany&&actualCompany!==accountId){skipped.otherCompany++;continue;}
   // Whop may omit company details on a company-filtered list response.
   // Never use this fallback for an unscoped API request.
   if(!actualCompany&&!scopedByCompany){skipped.otherCompany++;continue;}
   const normalized=actualCompany?payment:{...payment,company:{id:accountId}};
   const record=normalizePayment(normalized,planId);
   if(!record){skipped.invalid++;continue;}
   const result=await storeActivity(bucket,record);
   if(result.stored)imported++;else skipped.existing++;
  }
  if(!data.page_info?.has_next_page||!data.page_info?.end_cursor)break;
  cursor=data.page_info.end_cursor;
 }
 console.info('Whop payment history verification',{reviewed,imported,...skipped});
 return {status:'ok',reviewed,imported,...skipped};
}

export async function sendHistoricalSummary(bucket,{imported}){
 const target=webhookTarget(process.env.BRO_DISCORD_WEBHOOK_PUBLIC_ACTIVITY);
 if(!target)return {configured:false,sent:false};
 const marker='private/activity/historical-summary-once.json';
 if(await bucket.head(marker))return {configured:true,sent:false,alreadySent:true};
 const recent=await recentPurchases(bucket);
 const formatDate=v=>new Date(v.date).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'});
 const lines=recent.map(v=>'• '+v.plan+' · '+new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(v.amount)+' · '+formatDate(v)).join('\n');
 const body={
  username:'BRO. · Achats',
  content:'**Historique des achats Bro Client**\n'+imported+' achat(s) vérifié(s) ajouté(s) au tableau.\n'+lines+'\nMerci à tous pour votre confiance.',
  allowed_mentions:{parse:[]}
 };
 try{
  const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(4500)});
  if(!response.ok)return {configured:true,sent:false};
  await bucket.put(marker,JSON.stringify({sentAt:new Date().toISOString(),imported}),{onlyIf:{etagDoesNotMatch:'*'}});
  return {configured:true,sent:true};
 }catch{return {configured:true,sent:false};}
}
