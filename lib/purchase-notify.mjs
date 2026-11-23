import {planForProduct,planForCheckout} from './activity.mjs';
const envName={day:'BRO_DISCORD_WEBHOOK_DAY',week:'BRO_DISCORD_WEBHOOK_WEEK',
 month:'BRO_DISCORD_WEBHOOK_MONTH',life:'BRO_DISCORD_WEBHOOK_LIFETIME'};
const label={day:'1 jour',week:'1 semaine',month:'1 mois',life:'Lifetime'};
const isDiscord=v=>typeof v==='string'&&/^\d{17,20}$/.test(v);
const sanitize=(v,max=140)=>typeof v==='string'?v.replace(/[@`*|<>\r\n]/g,'').slice(0,max):'Non disponible';
const account='biz_emxZArodB6p2Af';
const signedRef=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
export function planForPayment(payment){
 return planForProduct(payment?.product?.id??payment?.product_id)
   ??planForCheckout(payment?.plan?.id??payment?.plan_id??payment?.variant?.id??payment?.variant_id);
}
function webhookUrl(planId){
 const source=process.env[envName[planId]];
 if(!source)return null;
 try{
  const url=new URL(source);
  return url.protocol==='https:'&&url.hostname==='discord.com'&&!url.username&&!url.password&&
    /^\/api\/webhooks\/\d{17,20}\/[a-zA-Z0-9_-]+$/.test(url.pathname)?url.href:null;
 }catch{return null;}
}
export async function verifiedPaymentOrder(bucket,payment){
 const ref=payment?.metadata?.bro_order;
 if(!signedRef(ref))return null;
 const stored=await bucket.get('private/orders/'+ref);
 if(!stored)return null;
 const order=await stored.json();
 if(!isDiscord(order?.discordId))return null;
 const variant=payment.variant?.id??payment.variant_id??payment.plan?.id??payment.plan_id;
 const checkoutId=payment.checkout_configuration?.id??payment.checkout_configuration_id;
 if(variant&&variant!==order.variant)return null;
 if(checkoutId&&checkoutId!==order.checkoutId)return null;
 if(planForPayment(payment)&&planForPayment(payment)!==order.planId)return null;
 return order;
}
export async function notifyVerifiedPurchase(bucket,order,payment,{historical=false}={}){
 const planId=order?.planId??planForPayment(payment);
 if(!Object.hasOwn(envName,planId||''))return {ok:false,configured:false,reason:'unknown_plan'};
 const target=webhookUrl(planId);
 if(!target)return {ok:false,configured:false,reason:'missing_webhook'};
 if(!/^pay_[a-zA-Z0-9]+$/.test(payment?.id||''))return {ok:false,configured:true,reason:'invalid_payment'};
 const paidAt=payment?.paid_at;
 if((payment.status&&payment.status!=='paid')||!paidAt||!Number.isFinite(Date.parse(paidAt))||
   payment.refunded_at||payment.auto_refunded||Number(payment.refunded_amount||0)>0||
   payment.substatus==='refunded'||(payment.account_id??payment.company?.id??payment.company_id)!==account)
   return {ok:false,configured:true,reason:'unverified_payment'};
 const marker='private/notifications/sent/'+payment.id+'.json';
 if(await bucket.head(marker))return {ok:true,alreadySent:true,configured:true};
 const discordId=isDiscord(order?.discordId)?order.discordId:null;
 const whopId=payment.user?.id||payment.user_id||payment.member?.id||payment.member_id||null;
 const amount=Number(payment.amount_charged?.amount??payment.total);
 const currency=String(payment.amount_charged?.currency??payment.currency??'EUR').toUpperCase();
 const money=Number.isFinite(amount)&&currency==='EUR'
   ?new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(amount)
   :'Montant indisponible';
 const fields=[
  {name:'Offre',value:label[planId],inline:true},
  {name:'Montant',value:money,inline:true},
  {name:'Paiement Whop',value:sanitize(payment.id),inline:false},
  {name:'Utilisateur Whop',value:sanitize(whopId),inline:true},
  {name:'Compte Discord',value:discordId?`<@${discordId}> · ${discordId}`:'Non associé à Discord',inline:false},
  {name:'Date du paiement',value:new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'}).format(new Date(paidAt)),inline:true}
 ];
 const body={
  username:'BRO CLIENT · Gestion',
  content:discordId?`Achat confirmé · <@${discordId}>`:'Achat confirmé · Compte Discord non associé',
  embeds:[{title:historical?'Paiement confirmé · rattrapage':'Paiement confirmé · BRO CLIENT',
    color:0x7da8d1,fields,timestamp:new Date(paidAt).toISOString(),
    footer:{text:'BRO CLIENT · Notifications des ventes'}}],
  allowed_mentions:{parse:[],users:discordId?[discordId]:[]}
 };
 try{
  const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(4500)});
  if(!response.ok){
    console.error('Discord staff notification failed',{plan:planId,status:response.status});
    return {ok:false,configured:true,status:response.status};
  }
  await bucket.put(marker,JSON.stringify({sentAt:new Date().toISOString(),plan:planId}),
    {onlyIf:{etagDoesNotMatch:'*'}});
  return {ok:true,configured:true};
 }catch(e){
  console.error('Discord staff notification network failure',{plan:planId,reason:e?.name});
  return {ok:false,configured:true};
 }
}
const parisDate=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export async function reconcilePaymentNotifications(bucket,{apiKey,accountId,date='today',limit=35}={}){
 if(!apiKey||accountId!==account)return {status:'not_configured',sent:0};
 let cursor,reviewed=0,eligible=0,sent=0,alreadySent=0,unlinked=0,errors=0;
 const current=parisDate(new Date());
 for(let page=0;page<3;page++){
  let response,scoped=false;
  // Match the same validated Whop pagination fallbacks as the activity importer.
  for(const withCompany of [true,false]){
   const url=new URL('https://api.whop.com/api/v1/payments');
   url.searchParams.set('first','50');
   if(withCompany)url.searchParams.set('company_id',accountId);
   if(cursor)url.searchParams.set('after',cursor);
   response=await fetch(url,{headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'},
     redirect:'error',signal:AbortSignal.timeout(8000)});
   scoped=withCompany;
   if(response.status!==400)break;
  }
  if(!response.ok){
   console.error('Whop notification reconciliation failed',{status:response.status});
   return {status:'whop_error',http:response.status,reviewed,sent,alreadySent,errors};
  }
  const data=await response.json();
  if(!Array.isArray(data.data))return {status:'invalid_response',reviewed,sent};
  const candidates=[];
  for(const payment of data.data){
   reviewed++;
   if(reviewed>150)break;
   const paymentDate=payment?.paid_at;
   if(!paymentDate||!Number.isFinite(Date.parse(paymentDate)))continue;
   if(date==='today'&&parisDate(new Date(paymentDate))!==current)continue;
   if(date==='recent'&&Date.parse(paymentDate)<Date.now()-36*3600000)continue;
   const company=payment.account_id??payment.company?.id??payment.company_id;
   if(company&&company!==accountId)continue;
   if(!company&&!scoped)continue;
   const normalized=company?payment:{...payment,company:{id:accountId}};
   const planId=planForPayment(payment);
   if(!planId||!Object.hasOwn(envName,planId)||
      (normalized.status&&normalized.status!=='paid')||normalized.refunded_at||normalized.auto_refunded||
      Number(normalized.refunded_amount||0)>0)continue;
   eligible++;
   candidates.push({payment:normalized,planId});
  }
  // Bound execution time on serverless. Successful sends are idempotent by payment ID.
  for(let i=0;i<candidates.length;i+=4){
   const batch=candidates.slice(i,i+4);
   const results=await Promise.all(batch.map(async({payment,planId})=>{
    try{
      const verified=await verifiedPaymentOrder(bucket,payment);
      return {order:verified??{planId},result:await notifyVerifiedPurchase(bucket,verified??{planId},payment,{historical:true})};
    }catch(e){console.error('Notification replay error',e?.name);return {result:{ok:false}};}
   }));
   for(const item of results){
    if(!item.order?.discordId)unlinked++;
    if(item.result?.alreadySent)alreadySent++;
    else if(item.result?.ok)sent++;
    else errors++;
   }
   if(sent+alreadySent+errors>=limit)break;
  }
  if(sent+alreadySent+errors>=limit||!data.page_info?.has_next_page||!data.page_info?.end_cursor)break;
  cursor=data.page_info.end_cursor;
 }
 return {status:errors?'partial':'ok',reviewed,eligible,sent,alreadySent,unlinked,errors};
}
