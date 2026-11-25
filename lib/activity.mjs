import {createHash} from 'node:crypto';

const PREFIX='private/activity/receipts/';
const CONSENT_PREFIX='private/activity/consent/';
const RECENT_INDEX='private/activity/recent-index-v2.json';
const labels={day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'};
const productPlans={
  prod_ZrNuFIODHTxMx:'day',
  prod_m8OHqP9zv7liA:'week',
  prod_tKudM82xNhny0:'month',
  prod_xejMeqvQCPugc:'life',
  prod_Qs0u7iy24c6j3:'day',
  prod_dbz8E6hOyIiUP:'week',
  prod_ly2WvPXYW1TfY:'month',
  prod_WRQUxXTbiAwjD:'life'
};
const checkoutPlans={
  plan_MCtWYReKKKb9m:'day',
  plan_kPcl5mzGmRq2Q:'week',
  plan_iN2Oc79WLycrs:'month',
  plan_p90wN1m6OLoEH:'life',
  plan_2XsZR1EchcSOj:'day',
  plan_sIer2uLNR0Idi:'week',
  plan_jzDhXvlF2aSQc:'month',
  plan_3G7GUcXlBFZJX:'life'
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
export const safeUsername=name=>{
 if(typeof name!=='string')return null;
 if(name.includes('@'))return null;
 const s=name.replace(/[\r\n\t<>]/g,'').trim().replace(/#\d{1,4}$/,'').trim().slice(0,32);
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
export async function getActivityPreference(bucket,discordId,defaultVisible=false){
 if(!/^\d{17,20}$/.test(discordId||''))return false;
 const item=await bucket.get(preferenceKey(discordId));
 return item?(await item.json())?.showPublic===true:defaultVisible===true;
}
export async function setActivityPreference(bucket,user,consent){
 if(!/^\d{17,20}$/.test(user?.discordId||''))throw Error('discord_identity_required');
 const visible=consent===true;
 // Only this authenticated Discord user can opt into public attribution.
 await bucket.put(preferenceKey(user.discordId),JSON.stringify({showPublic:visible,updatedAt:new Date().toISOString()}));
 const username=visible?safeUsername(user.discordUsername):null;
 const avatar=visible?safeAvatar(user.discordAvatar):null;
 let cursor;
 for(let page=0;page<8;page++){
   const result=await bucket.list({prefix:PREFIX,limit:100,cursor});
   for(const entry of result.objects){
     const stored=await bucket.get(entry.key,{forWrite:true});
     if(!stored)continue;
     const record=await stored.json();
     // Anonymous or unverified payments MUST never be guessed from a name,
     // email address or membership in a Discord guild.
     if(record?.discordId!==user.discordId)continue;
     const reveal=visible&&!record.privatePurchase;
     record.name=reveal?(username||'Client BRO'):'Client BRO';
     record.avatar=reveal?avatar:null;
     record.publicIdentity=reveal&&!!username;
     await bucket.put(entry.key,JSON.stringify(record),{onlyIf:{etagMatches:stored.etag}});
   }
   if(!result.truncated||!result.cursor)break;
   cursor=result.cursor;
 }
 return {showPublic:visible};
}
const safeAmount=v=>{
 const n=Number(v);
 return Number.isFinite(n)&&n>=0&&n<=100000?Math.round(n*100)/100:null;
};
export function normalizePayment(payment,planId,{visible=false,username=null,avatar=null,accountId=process.env.WHOP_ACCOUNT_ID}={}){
 const id=payment?.id;
 const plan=labels[planId];
 const date=payment?.paid_at;
 const amount=safeAmount(payment?.amount_charged?.amount??payment?.total);
 const currency=String(payment?.amount_charged?.currency??payment?.currency??'EUR').toUpperCase();
 const company=payment?.account_id||payment?.company?.id||payment?.company_id;
 if((payment?.status && payment.status!=='paid') || !payment?.paid_at || payment?.refunded_at || payment?.auto_refunded || Number(payment?.refunded_amount||0)>0 || payment?.substatus==='refunded')return null;
 if(!/^pay_[a-zA-Z0-9]+$/.test(id||'')||!plan||!Number.isFinite(Date.parse(date))||
    amount===null||currency!=='EUR'||!accountId||company!==accountId)return null;
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
 const existing=await bucket.get(path,{forWrite:true});
 if(existing){
   const previous=await existing.json();
   // Upgrade an anonymous import only after a payment has been linked to a
   // server-created, verified order. Never attach to a different Discord ID.
   if(/^\d{17,20}$/.test(record.discordId||'')&&
      (!previous?.discordId||previous.discordId===record.discordId)){
     const linked={...previous,discordId:record.discordId,
       autoPublic:previous.autoPublic===true||record.autoPublic===true,
       privatePurchase:previous.privatePurchase===true||record.privatePurchase===true,
       name:record.publicIdentity?record.name:'Client BRO',
       avatar:record.publicIdentity?record.avatar:null,
       publicIdentity:record.publicIdentity===true};
     await bucket.put(path,JSON.stringify(linked),{onlyIf:{etagMatches:existing.etag}});
     await refreshIndexSafely(bucket,linked);
     return {stored:false,updated:true,already:true};
   }
   await refreshIndexSafely(bucket,previous);
   return {stored:false,already:true};
 }
 const saved=await bucket.put(path,JSON.stringify(record),{onlyIf:{etagDoesNotMatch:'*'}});
 if(saved)await refreshIndexSafely(bucket,record);
 return {stored:!!saved,already:!saved};
}
const validReceipt=record=>record&&/^pay_[A-Za-z0-9]+$/.test(record.paymentId||'')&&labels[record.planId]&&Number.isFinite(Date.parse(record.date))&&safeAmount(record.amount)!==null;
const rankRecent=items=>[...new Map(items.filter(validReceipt).map(r=>[r.paymentId,{paymentId:r.paymentId,planId:r.planId,date:r.date,amount:r.amount}])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,20);
async function readIndex(bucket,forWrite=false){const blob=await bucket.get(RECENT_INDEX,{forWrite});const value=blob?await blob.json():null;return {blob,items:Array.isArray(value?.items)?value.items.filter(validReceipt):null};}
async function updateRecentIndex(bucket,record){
 if(!validReceipt(record))return;
 for(let i=0;i<6;i++){
  const {blob,items}=await readIndex(bucket,true);
  if(!items){await rebuildRecentIndex(bucket);continue;}
  const next=rankRecent([...items,record]);
  const saved=await bucket.put(RECENT_INDEX,JSON.stringify({items:next}),{onlyIf:{etagMatches:blob.etag}});
  if(saved)return;
 }
 throw Error('activity_index_conflict');
}
async function refreshIndexSafely(bucket,record){
 try{await updateRecentIndex(bucket,record);}
 catch(error){console.error('Activity index update pending',error?.name);try{await rebuildRecentIndex(bucket);}catch(e){console.error('Activity index rebuild pending',e?.name);}}
}
export async function rebuildRecentIndex(bucket){
 let cursor;const all=[];
 for(let page=0;page<8;page++){
  const result=await bucket.list({prefix:PREFIX,limit:100,cursor});
  for(let i=0;i<result.objects.length;i+=12){
   const rows=await Promise.all(result.objects.slice(i,i+12).filter(x=>x.key.startsWith(PREFIX)).map(async item=>{const content=await bucket.get(item.key);return content?await content.json():null;}));all.push(...rows.filter(validReceipt));
  }
  if(!result.truncated||!result.cursor)break;cursor=result.cursor;
 }
 for(let i=0;i<6;i++){const {blob,items}=await readIndex(bucket,true);const next=rankRecent([...(items||[]),...all]);const saved=await bucket.put(RECENT_INDEX,JSON.stringify({items:next}),{onlyIf:blob?{etagMatches:blob.etag}:{etagDoesNotMatch:'*'}});if(saved)return next;}
 return rankRecent(all);
}
export async function recentPurchases(bucket){
 const {items}=await readIndex(bucket);const index=items??await rebuildRecentIndex(bucket);
 const records=await Promise.all(index.map(async r=>{const x=await bucket.get(PREFIX+r.paymentId+'.json');return x?await x.json():null;}));
 return Promise.all(records.filter(validReceipt).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,5).map(async({plan,planId,amount,currency,date,name,avatar,discordId,autoPublic,privatePurchase})=>{
  let visible=false;
  if(!privatePurchase&&/^\d{17,20}$/.test(discordId||'')){
   try{
    visible=await getActivityPreference(bucket,discordId,autoPublic===true);
    if(visible){
     const profile=await bucket.get('private/bro-accounts/v1/'+discordId+'.json');
     if(profile){const account=await profile.json();if(account?.discordId===discordId){name=safeUsername(account.displayName)||name;avatar=safeAvatar(account.avatar)||avatar;}}
    }
   }catch{visible=false;}
  }
  const publicName=visible?safeUsername(name):null;
  const identifiable=!!publicName&&publicName!=='Client BRO';
  return {plan,planId,amount,currency,date,name:identifiable?publicName:'Client BRO',avatar:identifiable?safeAvatar(avatar):null};
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
 const amount=new Intl.NumberFormat('fr-FR',{style:'currency',currency:record.currency||'EUR'}).format(record.amount);
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
export async function backfillWhopHistory(bucket,{apiKey,accountId,maxPages=2,onVerifiedPayment=null}){
 if(!apiKey||!/^biz_[A-Za-z0-9]+$/.test(accountId||''))return {status:'not_configured',imported:0};
 let cursor,imported=0,reviewed=0,linked=0;
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
     ??planForCheckout(payment.variant?.id??payment.variant_id??payment.plan?.id??payment.plan_id);
   if(!planId){skipped.otherProduct++;continue;}
   const actualCompany=payment.account_id??payment.company?.id??payment.company_id;
   if(actualCompany&&actualCompany!==accountId){skipped.otherCompany++;continue;}
   // Whop may omit company details on a company-filtered list response.
   // Never use this fallback for an unscoped API request.
   if(!actualCompany&&!scopedByCompany){skipped.otherCompany++;continue;}
   const normalized=actualCompany?payment:{...payment,company:{id:accountId}};
   const record=normalizePayment(normalized,planId,{accountId});
   if(!record){skipped.invalid++;continue;}
   const result=await storeActivity(bucket,record);
   if(result.stored)imported++;else skipped.existing++;
   if(onVerifiedPayment&&normalized.metadata?.bro_order)try{if(await onVerifiedPayment(normalized))linked++;}catch(error){console.error('Verified order recovery pending',error?.name);}
  }
  if(!data.page_info?.has_next_page||!data.page_info?.end_cursor)break;
  cursor=data.page_info.end_cursor;
 }
 console.info('Whop payment history verification',{reviewed,imported,...skipped});
 return {status:'ok',reviewed,imported,linked,...skipped};
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
