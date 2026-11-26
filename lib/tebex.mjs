import {createHash} from 'node:crypto';
import {broPurchaseReference} from './purchase-receipt.mjs';
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
const money=v=>typeof v?.amount==='number'&&Number.isFinite(v.amount)&&v.amount>=0&&v.amount<=100000&&/^[A-Z]{3}$/.test(v.currency||'');
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
// Called only by the verified webhook or authenticated server-side Tebex lookup.
// No public endpoint can issue an entitlement from a client-supplied receipt.
export async function completeTebexPayment(bucket,event,{verifyBasket=verifyTebexBasket,reconcile=reconcileMember,notify=notifyVerifiedPurchase,publicNotify=sendPublicPurchase}={}){
 if(event?.type!=='payment.completed')return {status:200,body:{received:true,ignored:true}};
 if(process.env.BRO_KEY_DELIVERY_PAUSED==='true')return {status:503,body:{error:'delivery_paused'}};
 const p=event.subject,ref=p?.custom?.bro_order,tx=p?.transaction_id;
 if(!orderRef(ref)||!txId(tx)||Number(p?.status?.id)!==1||!Array.isArray(p.products)||p.products.length!==1||Number(p.products[0].quantity)!==1||!money(p.price)||!Number.isFinite(Date.parse(p.created_at)))return {status:422,body:{error:'unverified_payment'}};
 const order=await read(bucket,'private/tebex/orders/'+ref+'.json');
 if(!order||order.provider!=='tebex'||packages[order.planId]!==order.packageId||String(p.products[0].id)!==order.packageId||!isSnowflake(order.discordId)||!(/^[a-f0-9]{64}$/).test(order.owner||'')||!(/^[A-Za-z0-9-]{10,128}$/).test(order.basketId||'')||!Number.isFinite(Date.parse(order.createdAt))||Date.parse(p.created_at)<Date.parse(order.createdAt)-60000)return {status:422,body:{error:'order_mismatch'}};
 const date=new Date(p.created_at).toISOString(),paymentId=keyFor(tx),expiresAt=expiryForPlan(order.planId,date);
 const broReference=broPurchaseReference(paymentId);
 const record={provider:'tebex',transactionId:tx,broReference,orderRef:ref,paymentId,discordId:order.discordId,owner:order.owner,planId:order.planId,date,expiresAt,amount:p.price.amount,currency:p.price.currency};
 const known=await read(bucket,receiptPath(paymentId));
 if(known&&!same(known,record))return {status:409,body:{error:'payment_conflict'}};
 if(!known){
  const basket=await verifyBasket(order,tx,ref);
  // The paid Tebex basket must correspond to the amount reported in the
  // signed event when both are expressed in the same store currency.
  if(record.amount===0&&(basket.currency!==record.currency||typeof basket.total_price!=='number'||!Number.isFinite(basket.total_price)||basket.total_price!==0))return {status:422,body:{error:'payment_amount_mismatch'}};
  if(basket.currency===record.currency&&typeof basket.total_price==='number'&&Math.abs(basket.total_price-record.amount)>0.011)return {status:422,body:{error:'payment_amount_mismatch'}};
  if(!await reserve(bucket,receiptPath(paymentId),record,old=>same(old,record)))return {status:409,body:{error:'payment_conflict'}};
 }
 // One transaction per server-created order, one owner per transaction.
 if(!await reserve(bucket,'private/tebex/order-payments/'+ref+'.json',{transactionId:tx,paymentId},old=>old.transactionId===tx&&old.paymentId===paymentId))return {status:409,body:{error:'order_already_paid'}};
 if(!await reserve(bucket,'private/payment-owners/v1/'+paymentId+'.json',{discordId:order.discordId},old=>old.discordId===order.discordId))return {status:409,body:{error:'payment_owner_conflict'}};
 const entitlement={paymentId,planId:order.planId,expiresAt,provider:'tebex',transactionId:tx};
 if(!await reserve(bucket,'private/discord-entitlements/'+order.discordId+'/'+paymentId,entitlement,old=>old.paymentId===paymentId&&old.planId===order.planId&&old.expiresAt===expiresAt&&old.transactionId===tx))return {status:409,body:{error:'entitlement_conflict'}};
 const invoice={id:paymentId,title:labels[order.planId],date,amount:record.amount,currency:record.currency,provider:'tebex',transactionId:tx,broReference};
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
 // A public Discord announcement is optional and has its own durable retry
 // state. Never reject a successfully delivered order because this channel fails.
 let publicOk=processed?.publicOk===true;
 if(!publicOk){
  try{publicOk=(await attemptPublicNotice(bucket,marker,activity,publicNotify)).ok;}
  catch(error){console.warn('Tebex public announcement deferred',{reason:error?.name});}
 }
 const noticeOk=notification.ok===true;
 const outcome={rolesOk,publicOk,noticeOk,delivery:delivery.status,at:new Date().toISOString()};
 for(let i=0;i<5;i++){
  const old=await bucket.get(marker,{forWrite:true});const prev=old?await old.json():{};
  const merged={...outcome,rolesOk:outcome.rolesOk||prev.rolesOk===true,publicOk:outcome.publicOk||prev.publicOk===true,noticeOk:outcome.noticeOk||prev.noticeOk===true};
  if(await bucket.put(marker,JSON.stringify(merged),{onlyIf:old?{etagMatches:old.etag}:{etagDoesNotMatch:'*'}})){
   if(!merged.rolesOk||!merged.noticeOk)return {status:503,body:{error:'side_effect_pending'}};
   if(!merged.publicOk)console.warn('Tebex public announcement queued',{plan:order.planId});
   return {status:200,body:{received:true,delivery:delivery.status}};
  }
 }
 return {status:503,body:{error:'receipt_pending'}};
}

// Independent public-announcement retry. The marker remains false until an
// actual success (or the optional channel is intentionally unconfigured).
async function attemptPublicNotice(bucket,marker,activity,publicNotify){
 const leasePath=marker+'.public-lease';
 const lease=await bucket.get(leasePath,{forWrite:true});
 const previous=lease?await lease.json():null;
 if(previous?.until>Date.now())return {ok:false,busy:true};
 const lock=await bucket.put(leasePath,JSON.stringify({until:Date.now()+60000}),{onlyIf:lease?{etagMatches:lease.etag}:{etagDoesNotMatch:'*'}});
 if(!lock)return {ok:false,busy:true};
 let visible=false;
 try{visible=!activity.privatePurchase&&activity.publicIdentity&&await getActivityPreference(bucket,activity.discordId);}catch{}
 const result=await publicNotify(bucket,visible?activity:{...activity,publicIdentity:false,name:'Client BRO',avatar:null});
 return {ok:!result.configured||result.ok===true,status:result.status};
}
const scanPrefix='private/tebex/processed/';
const scanState='private/tebex/public-retry-cursor.json';
export async function retryTebexPublicNotices(bucket,{publicNotify=sendPublicPurchase,limit=4,scanLimit=60}={}){
 const checkpoint=await read(bucket,scanState);
 let cursor=typeof checkpoint?.cursor==='string'?checkpoint.cursor:undefined;
 const page=await bucket.list({prefix:scanPrefix,limit:Math.max(1,Math.min(60,scanLimit)),cursor});
 let attempted=0,sent=0,failed=0,stopped=false;
 for(const item of page.objects){
  const match=/^private\/tebex\/processed\/(pay_tebex[a-f0-9]{64})\.json$/.exec(item.key);
  if(!match)continue;
  const marker=await read(bucket,item.key);
  if(!marker||marker.publicOk===true||!['assigned','waiting_stock','expired'].includes(marker.delivery))continue;
  if(attempted>=limit){stopped=true;break;}
  const id=match[1],receipt=await read(bucket,receiptPath(id)),activity=await read(bucket,'private/activity/receipts/'+id+'.json');
  if(!receipt||!activity||receipt.paymentId!==id||receipt.provider!=='tebex'||activity.paymentId!==id||activity.provider!=='tebex'||receipt.transactionId!==activity.transactionId||receipt.discordId!==activity.discordId||receipt.planId!==activity.planId||receipt.amount!==activity.amount||receipt.currency!==activity.currency||receipt.date!==activity.date)continue;
  attempted++;
  try{
   const result=await attemptPublicNotice(bucket,item.key,activity,publicNotify);
   if(result.ok){
    for(let i=0;i<5;i++){
     const current=await bucket.get(item.key,{forWrite:true});if(!current)break;
     const value=await current.json();
     if(value.publicOk===true||await bucket.put(item.key,JSON.stringify({...value,publicOk:true}),{onlyIf:{etagMatches:current.etag}})){sent++;break;}
    }
   }else if(!result.busy){failed++;if([401,403,404,429].includes(result.status)){stopped=true;break;}}
  }catch(error){failed++;console.warn('Tebex public retry failed',{reason:error?.name});}
 }
 // Keep this page if work was capped or the downstream endpoint is unavailable.
 // On successful scans move through the ledger and wrap to catch new inserts.
 if(!stopped)await bucket.put(scanState,JSON.stringify({cursor:page.truncated&&page.cursor?page.cursor:null}));
 return {attempted,sent,failed,stopped};
}

// Recovery is limited to the transaction configured on the server. It never
// accepts a customer-supplied payload or chooses the Discord account or pass.
export async function recoverConfiguredTebexPayment(bucket,{transactionId=process.env.BRO_TEBEX_RECOVERY_TX,fetchPayment=fetchTebexPayment,complete=completeTebexPayment}={}){
 if(!transactionId)return {status:'not_configured'};
 if(!txId(transactionId))return {status:'invalid_transaction'};
 const marker=await read(bucket,'private/tebex/processed/'+keyFor(transactionId)+'.json');
 if(marker?.rolesOk&&marker?.publicOk&&marker?.noticeOk&&['assigned','waiting_stock','expired'].includes(marker.delivery))return {status:'already_processed',delivery:marker.delivery};
 const payment=await fetchPayment(transactionId);
 if(payment?.transaction_id!==transactionId||Number(payment?.status?.id)!==1||!money(payment.price))return {status:'unverified_payment'};
 const result=await complete(bucket,{type:'payment.completed',subject:payment});
 return {status:result.status===200?'processed':'pending',http:result.status,delivery:result.body?.delivery,reason:result.body?.error};
}
export async function fetchTebexPayment(transactionId){
 if(!txId(transactionId))throw Error('invalid_transaction');
 const project=process.env.TEBEX_PROJECT_ID?.trim(),secret=process.env.TEBEX_PRIVATE_KEY?.trim();
 if(!project||!secret)throw Error('tebex_recovery_not_configured');
 const response=await fetch('https://checkout.tebex.io/api/payments/'+encodeURIComponent(transactionId)+'?type=txn_id',{headers:{Authorization:'Basic '+Buffer.from(project+':'+secret).toString('base64'),Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('tebex_payment_http_'+response.status);
 const data=await response.json();return data?.data??data;
}
