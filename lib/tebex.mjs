import {createHash} from 'node:crypto';
import {expiryForPlan,reconcileMember} from './discord.mjs';
import {queuePaidKey,isSnowflake} from './fulfillment.mjs';
import {storeActivity,getActivityPreference,safeAvatar,safeUsername,sendPublicPurchase} from './activity.mjs';
import {readAccount} from './accounts.mjs';
import {notifyVerifiedPurchase} from './purchase-notify.mjs';

const packages={day:'7832046',week:'7832045',month:'7832044',life:'7832042'};
const labels={day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'};
const txId=v=>typeof v==='string'&&/^tbx-[A-Za-z0-9-]{6,100}$/.test(v);
const orderRef=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const keyFor=tx=>'pay_tebex'+createHash('sha256').update(tx).digest('hex');
const receiptPath=id=>'private/tebex/payments/'+id+'.json';
const read=async(bucket,key)=>{const b=await bucket.get(key);return b?await b.json():null;};
async function reserve(bucket,key,value,match){
 if(await bucket.put(key,JSON.stringify(value),{onlyIf:{etagDoesNotMatch:'*'}}))return true;
 const existing=await read(bucket,key);
 return !!existing&&match(existing);
}
const same=(a,b)=>a.transactionId===b.transactionId&&a.orderRef===b.orderRef&&a.discordId===b.discordId&&a.planId===b.planId&&a.owner===b.owner&&a.amount===b.amount&&a.currency===b.currency&&a.date===b.date;
const money=v=>typeof v?.amount==='number'&&Number.isFinite(v.amount)&&v.amount>0&&v.amount<=100000&&/^[A-Z]{3}$/.test(v.currency||'');
export async function verifyTebexBasket(order,transactionId,ref){
 const token=process.env.TEBEX_PUBLIC_TOKEN?.trim();
 if(!token)throw Error('tebex_not_configured');
 const r=await fetch('https://headless.tebex.io/api/accounts/'+encodeURIComponent(token)+'/baskets/'+encodeURIComponent(order.basketId),{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('tebex_basket_http_'+r.status);
 const result=await r.json(),b=result.data??result;
 if(b.ident!==order.basketId||b.complete!==true||b.custom?.bro_order!==ref)throw Error('tebex_basket_not_confirmed');
 // Headless baskets may omit links.payment even after completion.
 // The signed payment.completed subject independently supplies the transaction
 // ID, status, custom order reference and purchased products. Require the
 // completed basket's independently retrieved order reference and products.
 // If a payment link IS present, require an exact transaction match.
 if(b.links?.payment!=null&&b.links.payment!==''){
  let link;try{link=new URL(b.links.payment);}catch{throw Error('tebex_transaction_mismatch');}
  if(link.protocol!=='https:'||link.hostname!=='checkout.tebex.io'||link.port||link.username||link.password||link.pathname!=='/api/payments/'+transactionId)throw Error('tebex_transaction_mismatch');
 }
 if(!Array.isArray(b.packages)||b.packages.length!==1||String(b.packages[0].id??b.packages[0].package?.id)!==order.packageId||Number(b.packages[0].qty??b.packages[0].in_basket?.quantity??b.packages[0].quantity)!==1)throw Error('tebex_basket_products_mismatch');
 return b;
}
// Only the signed webhook route may call this entry point. No public endpoint
// can issue an entitlement from a client-supplied receipt or redirect.
export async function completeTebexPayment(bucket,event,{verifyBasket=verifyTebexBasket,reconcile=reconcileMember,notify=notifyVerifiedPurchase,publicNotify=sendPublicPurchase}={}){
 if(event?.type!=='payment.completed')return {status:200,body:{received:true,ignored:true}};
 if(process.env.BRO_KEY_DELIVERY_PAUSED==='true')return {status:503,body:{error:'delivery_paused'}};
 const p=event.subject,ref=p?.custom?.bro_order,tx=p?.transaction_id;
 if(!orderRef(ref)||!txId(tx)||Number(p?.status?.id)!==1||!Array.isArray(p.products)||p.products.length!==1||Number(p.products[0].quantity)!==1||!money(p.price)||!Number.isFinite(Date.parse(p.created_at)))return {status:422,body:{error:'unverified_payment'}};
 const order=await read(bucket,'private/tebex/orders/'+ref+'.json');
 if(!order||order.provider!=='tebex'||packages[order.planId]!==order.packageId||String(p.products[0].id)!==order.packageId||!isSnowflake(order.discordId)||!(/^[a-f0-9]{64}$/).test(order.owner||'')||!(/^[A-Za-z0-9-]{10,128}$/).test(order.basketId||'')||!Number.isFinite(Date.parse(order.createdAt))||Date.parse(p.created_at)<Date.parse(order.createdAt)-60000)return {status:422,body:{error:'order_mismatch'}};
 const date=new Date(p.created_at).toISOString(),paymentId=keyFor(tx),expiresAt=expiryForPlan(order.planId,date);
 const record={provider:'tebex',transactionId:tx,orderRef:ref,paymentId,discordId:order.discordId,owner:order.owner,planId:order.planId,date,expiresAt,amount:p.price.amount,currency:p.price.currency};
 const known=await read(bucket,receiptPath(paymentId));
 if(known&&!same(known,record))return {status:409,body:{error:'payment_conflict'}};
 if(!known){
  const basket=await verifyBasket(order,tx,ref);
  // The paid Tebex basket must correspond to the amount reported in the
  // signed event when both are expressed in the same store currency.
  if(basket.currency===record.currency&&typeof basket.total_price==='number'&&Math.abs(basket.total_price-record.amount)>0.011)return {status:422,body:{error:'payment_amount_mismatch'}};
  if(!await reserve(bucket,receiptPath(paymentId),record,old=>same(old,record)))return {status:409,body:{error:'payment_conflict'}};
 }
 // One transaction per server-created order, one owner per transaction.
 if(!await reserve(bucket,'private/tebex/order-payments/'+ref+'.json',{transactionId:tx,paymentId},old=>old.transactionId===tx&&old.paymentId===paymentId))return {status:409,body:{error:'order_already_paid'}};
 if(!await reserve(bucket,'private/payment-owners/v1/'+paymentId+'.json',{discordId:order.discordId},old=>old.discordId===order.discordId))return {status:409,body:{error:'payment_owner_conflict'}};
 const entitlement={paymentId,planId:order.planId,expiresAt,provider:'tebex',transactionId:tx};
 if(!await reserve(bucket,'private/discord-entitlements/'+order.discordId+'/'+paymentId,entitlement,old=>old.paymentId===paymentId&&old.planId===order.planId&&old.expiresAt===expiresAt&&old.transactionId===tx))return {status:409,body:{error:'entitlement_conflict'}};
 const invoice={id:paymentId,title:labels[order.planId],date,amount:record.amount,currency:record.currency,provider:'tebex',transactionId:tx};
 if(!await reserve(bucket,'private/invoices/'+order.owner+'/'+paymentId,invoice,old=>old.transactionId===tx&&old.id===paymentId))return {status:409,body:{error:'invoice_conflict'}};
 const marker='private/tebex/processed/'+paymentId+'.json';
 const processed=await read(bucket,marker);
 // A later stock import can fulfill a waiting order using the same key ledger.
 let delivery={status:'expired'};
 if(expiresAt===null||Date.parse(expiresAt)>Date.now()){
  delivery=await queuePaidKey(bucket,{discordId:order.discordId,paymentId,planId:order.planId,expiresAt});
  if(!['assigned','waiting_stock'].includes(delivery.status))return {status:503,body:{error:'delivery_pending'}};
 }
 const autoPublic=order.feedVisibility==='public',privatePurchase=order.feedVisibility==='private';
 let visible=false,profile=null;
 try{visible=!privatePurchase&&await getActivityPreference(bucket,order.discordId,autoPublic);if(visible)profile=await readAccount(bucket,order.discordId);}catch{visible=false;}
 const display=visible?safeUsername(profile?.displayName??order.identity?.username):null;
 const avatar=display?safeAvatar(profile?.avatar??order.identity?.avatar):null;
 const activity={paymentId,provider:'tebex',transactionId:tx,planId:order.planId,plan:labels[order.planId],date,amount:record.amount,currency:record.currency,discordId:order.discordId,autoPublic,privatePurchase,
  name:display||'Client BRO',avatar,publicIdentity:!!display};
 await storeActivity(bucket,activity);
 const roles=processed?.rolesOk?{status:'already_synced'}:await reconcile(bucket,order.discordId);
 const rolesOk=['already_synced','role_granted','role_granted_lifetime','role_expired','not_member'].includes(roles.status);
 const notification=await notify(bucket,order,{id:paymentId,provider:'tebex',transactionId:tx,paid_at:date,status:'paid',amount_charged:{amount:record.amount,currency:record.currency}},{provider:'tebex'});
 // Private notice is serialized by the notification module. Public notices
 // also use a conditional lease to prevent concurrent webhook replays.
 let publicOk=processed?.publicOk===true;
 if(!publicOk){
  const leasePath=marker+'.public-lease';
  const lease=await bucket.get(leasePath,{forWrite:true});
  const old=lease?await lease.json():null;
  if(!old||old.until<Date.now()){
   const lock=await bucket.put(leasePath,JSON.stringify({until:Date.now()+60000}),{onlyIf:lease?{etagMatches:lease.etag}:{etagDoesNotMatch:'*'}});
   if(lock){const result=await publicNotify(bucket,activity);publicOk=!result.configured||result.ok;}
  }
 }
 // The conditional receipt is created only after the effects succeed. If the
 // process dies earlier, Tebex retries and the key ledger remains idempotent.
 const noticeOk=notification.ok===true;
 const outcome={rolesOk,publicOk,noticeOk,delivery:delivery.status,at:new Date().toISOString()};
 for(let i=0;i<5;i++){
  const old=await bucket.get(marker,{forWrite:true});const prev=old?await old.json():{};
  const merged={...outcome,rolesOk:outcome.rolesOk||prev.rolesOk===true,publicOk:outcome.publicOk||prev.publicOk===true,noticeOk:outcome.noticeOk||prev.noticeOk===true};
  if(await bucket.put(marker,JSON.stringify(merged),{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}})){
   if(!merged.rolesOk||!merged.publicOk||!merged.noticeOk)return {status:503,body:{error:'side_effect_pending'}};
   return {status:200,body:{received:true,delivery:delivery.status}};
  }
 }
 return {status:503,body:{error:'receipt_pending'}};
}
