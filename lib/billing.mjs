import {normalizePurchaseReceipt,purchaseReceiptPdf} from './purchase-receipt.mjs';
import {queuePaidKey} from './fulfillment.mjs';
import {readAccount} from './accounts.mjs';
import {expiryForPlan,reconcileMember} from './discord.mjs';
import {notifyVerifiedPurchase,planForPayment,verifiedPaymentOrder} from './purchase-notify.mjs';
import {getActivityPreference,normalizePayment,storeActivity,sendPublicPurchase,planForProduct} from './activity.mjs';
const enc = new TextEncoder();
const apiBase = "https://api.whop.com/api/v1";
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const isPaymentId = (s) => typeof s === "string" && /^pay_[A-Za-z0-9]+$/.test(s);
function whopUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["whop.com", "www.whop.com"].includes(url.hostname) || url.username || url.password || url.port || url.pathname === "/") throw Error("Lien Whop invalide.");
  return url;
}
function configured(env) {
  return Boolean(env.WHOP_API_KEY && env.WHOP_ACCOUNT_ID && env.WHOP_WEBHOOK_SECRET);
}
async function api(env, path, init = {}) {
  const response = await fetch(apiBase + path, {
    ...init,redirect:"error",signal:init.signal??AbortSignal.timeout(8000),
    headers:{
      Authorization:"Bearer "+env.WHOP_API_KEY,
      "Content-Type":"application/json",
      ...init.headers
    }
  });
  if(!response.ok){
    // Log safe diagnostics only. Never print API keys, buyer data or request bodies.
    console.error('Whop API failed',{route:path.split('/').slice(0,3).join('/'),status:response.status});
    throw Error('whop_api_'+response.status);
  }
  return response.json();
}
async function ownerKey(userId) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(userId));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
async function createCheckout(env, user, plan, origin) {
  // Never accept a Discord ID from the browser. It must come from the verified
  // Supabase session, obtained by /checkout/:plan on the server.
  const {id:userId,discordId}=user||{};
  if(!userId||!/^[0-9]{17,20}$/.test(discordId||''))throw Error('discord_session_required');
  if(!configured(env))throw Error('whop_not_configured');
  const link=whopUrl(plan.checkoutUrl);
  const variant=link.pathname.match(/\/checkout\/(plan_[A-Za-z0-9]+)\/?$/)?.[1];
  if(!variant)throw Error('plan_invalid');
  const ref=crypto.randomUUID();
  const owner=await ownerKey(userId);
  // The 128-bit random order ref is all Whop receives in metadata. The Discord
  // identity and private preference never leave the server-side private bucket.
  const order={
    owner,discordId,planId:plan.id,title:plan.name,variant,fulfillmentVersion:2,
    createdAt:new Date().toISOString(),
    identity:{username:user.discordUsername||user.displayName||user.username,avatar:user.discordAvatar}
  };
  // Save FIRST, so a confirmed webhook cannot outrun the order record.
  await env.BUCKET.put('private/orders/'+ref,JSON.stringify(order),{onlyIf:{etagDoesNotMatch:'*'}});
  const checkout=await api({...env,WHOP_API_KEY:env.WHOP_CHECKOUT_API_KEY||env.WHOP_API_KEY},'/checkout_configurations',{
    method:'POST',
    // Pin only checkout creation to the dated API matching account_id and variant_id.
    // Leave payment reads and webhook handling on their existing version.
    headers:{'Idempotency-Key':'bro-checkout-'+ref,'Api-Version-Date':'2026-11-20'},
    signal:AbortSignal.timeout(4500),
    body:JSON.stringify({
      account_id:env.WHOP_ACCOUNT_ID,
      variant_id:variant,
      mode:'payment',
      redirect_url:new URL('/#compte',origin).href,
      metadata:{bro_order:ref}
    })
  });
  if(!/^ch_[A-Za-z0-9]+$/.test(checkout?.id||''))throw Error('checkout_id_invalid');
  if((checkout.account_id??checkout.company_id??checkout.company?.id) && (checkout.account_id??checkout.company_id??checkout.company?.id)!==env.WHOP_ACCOUNT_ID)throw Error('checkout_company_invalid');
  const checkoutVariant=checkout.variant?.id??checkout.variant_id??checkout.plan?.id;
  if(checkoutVariant&&checkoutVariant!==variant)throw Error('checkout_variant_invalid');
  const terms=checkout.variant??checkout.plan;
  if(terms){
    const price=terms.billing_type==='renewal'?terms.renewal_price:terms.initial_price;
    if(terms.currency&&String(terms.currency).toLowerCase()!=='eur')throw Error('checkout_currency_invalid');
    if(price!==undefined&&price!==null&&Math.abs(Number(price)-Number(plan.price))>0.001)
      throw Error('checkout_price_mismatch');
  }
  const target=whopUrl(checkout.purchase_url);
  if(!/^\/checkout\//.test(target.pathname))throw Error('checkout_url_invalid');
  // Store checkout ID only after the official response has been validated.
  order.checkoutId=checkout.id;
  await env.BUCKET.put('private/orders/'+ref,JSON.stringify(order));
  console.info('Bro checkout linked',{plan:plan.id,result:'attributed'});
  return target.href;
}
// A payment can have only one owner. Create-only reservation also makes retries safe.
async function reservePaymentOwner(bucket,paymentId,discordId){
 const path='private/payment-owners/v1/'+paymentId+'.json';
 const written=await bucket.put(path,JSON.stringify({discordId}),{onlyIf:{etagDoesNotMatch:'*'}});
 if(written)return true;
 const old=await bucket.get(path);
 return !!old&&(await old.json()).discordId===discordId;
}
export async function attachVerifiedPayment(env,account,paymentId,operatorId){
 if(!configured(env)||!isPaymentId(paymentId)||!/^\d{17,20}$/.test(account?.discordId||'')||
    !/^\d{17,20}$/.test(operatorId||'')||typeof account.authId!=='string'||!account.authId)
  return {status:'invalid',error:'Compte ou paiement invalide.'};
 const p=await api(env,'/payments/'+paymentId);
 const planId=planForPayment(p);
 const record=normalizePayment(p,planId,{accountId:env.WHOP_ACCOUNT_ID});
 if(!record||p.id!==paymentId||(p.account_id??p.company?.id??p.company_id)!==env.WHOP_ACCOUNT_ID)
  return {status:'invalid_payment',error:'Paiement non confirmé, remboursé ou offre inconnue.'};
 // Never override an existing trusted order, including a reference whose record is missing.
 if(p.metadata?.bro_order){
  const ref=p.metadata.bro_order;
  const stored=typeof ref==='string'&&/^[a-f0-9-]{36}$/.test(ref)?await env.BUCKET.get('private/orders/'+ref):null;
  const original=stored?await stored.json():null;
  const variant=p.variant?.id??p.variant_id??p.plan?.id??p.plan_id;
  const checkout=p.checkout_configuration?.id??p.checkout_configuration_id;
  if(!original||original.discordId!==account.discordId||original.owner!==await ownerKey(account.authId)||
     original.planId!==planId||(variant&&variant!==original.variant)||(checkout&&checkout!==original.checkoutId))
   return {status:'conflict',error:'Ce paiement possède déjà une référence de commande différente ou non vérifiable.'};
 }
 const existing=await env.BUCKET.get('private/activity/receipts/'+paymentId+'.json');
 const receipt=existing?await existing.json():null;
 if(receipt?.discordId&&receipt.discordId!==account.discordId)return {status:'conflict',error:'Ce paiement est déjà rattaché à un autre compte.'};
 // Old notification records are not proof of ownership. A staff member must have
 // independently checked the buyer's receipt and authenticated Discord identity.
 if(!await reservePaymentOwner(env.BUCKET,paymentId,account.discordId))return {status:'conflict',error:'Ce paiement est déjà réservé à un autre compte.'};
 const owner=await ownerKey(account.authId);
 const expiresAt=expiryForPlan(planId,record.date);
 if(expiresAt===undefined)return {status:'invalid',error:'Durée inconnue.'};
 const invoice={id:paymentId,title:record.plan,date:record.date,amount:record.amount,currency:record.currency,pdfUrl:'/api/invoices/'+paymentId+'/pdf'};
 await env.BUCKET.put('private/invoices/'+owner+'/'+paymentId,JSON.stringify(invoice),{onlyIf:{etagDoesNotMatch:'*'}});
 await env.BUCKET.put('private/discord-entitlements/'+account.discordId+'/'+paymentId,JSON.stringify({paymentId,planId,expiresAt}),{onlyIf:{etagDoesNotMatch:'*'}});
 const visible=await getActivityPreference(env.BUCKET,account.discordId);
 const linked=normalizePayment(p,planId,{accountId:env.WHOP_ACCOUNT_ID,visible,username:account.displayName,avatar:account.avatar});
 linked.discordId=account.discordId;
 await storeActivity(env.BUCKET,linked);
 await env.BUCKET.put('private/payment-reconciliations/v1/'+paymentId+'.json',JSON.stringify({discordId:account.discordId,operatorId,at:new Date().toISOString()}),{onlyIf:{etagDoesNotMatch:'*'}});
 try{await reconcileMember(env.BUCKET,account.discordId);}catch(error){console.error('Discord reconciliation pending',error?.name);}
 return {status:'linked',plan:record.plan,username:account.username,active:expiresAt===null||Date.parse(expiresAt)>Date.now()};
}

// Recover an already verified historical order, without guessing identity from email or name.
export async function recoverAttributedPayment(env,payment){
 const order=await verifiedPaymentOrder(env.BUCKET,payment);
 if(!order||!/^ch_[A-Za-z0-9]+$/.test(order.checkoutId||'')||!/^[a-f0-9]{64}$/.test(order.owner||'')||
    (payment.account_id??payment.company?.id??payment.company_id)!==env.WHOP_ACCOUNT_ID)return false;
 const record=normalizePayment(payment,order.planId,{accountId:env.WHOP_ACCOUNT_ID});
 if(!record||planForPayment(payment)!==order.planId)return false;
 const expiresAt=expiryForPlan(order.planId,record.date);
 if(expiresAt===undefined)return false;
 const existing=await env.BUCKET.get('private/activity/receipts/'+record.paymentId+'.json');
 if(existing){const old=await existing.json();if(old.discordId&&old.discordId!==order.discordId)return false;}
 if(!await reservePaymentOwner(env.BUCKET,record.paymentId,order.discordId))return false;
 const invoice={id:record.paymentId,title:record.plan,date:record.date,amount:record.amount,currency:record.currency,pdfUrl:'/api/invoices/'+record.paymentId+'/pdf'};
 await env.BUCKET.put('private/invoices/'+order.owner+'/'+record.paymentId,JSON.stringify(invoice),{onlyIf:{etagDoesNotMatch:'*'}});
 const entitlement=await env.BUCKET.put('private/discord-entitlements/'+order.discordId+'/'+record.paymentId,JSON.stringify({paymentId:record.paymentId,planId:order.planId,expiresAt}),{onlyIf:{etagDoesNotMatch:'*'}});
 if(order.fulfillmentVersion===2){const delivery=await queuePaidKey(env.BUCKET,{discordId:order.discordId,paymentId:record.paymentId,planId:order.planId,expiresAt});if(['unconfigured','unverified','conflict'].includes(delivery.status))throw Error('license_pending');}
 let profile=null;
 try{profile=await readAccount(env.BUCKET,order.discordId);}catch{}
 const visible=await getActivityPreference(env.BUCKET,order.discordId);
 const linked=normalizePayment(payment,order.planId,{accountId:env.WHOP_ACCOUNT_ID,visible,username:profile?.displayName??order.identity?.username,avatar:profile?.avatar??order.identity?.avatar});
 linked.discordId=order.discordId;
 await storeActivity(env.BUCKET,linked);
 if(entitlement)try{await reconcileMember(env.BUCKET,order.discordId);}catch(error){console.error('Discord reconciliation pending',error?.name);}
 return true;
}

async function validSignature(req, body, secret) {
  const timestamp = req.headers.get("webhook-timestamp") || "";
  const id = req.headers.get("webhook-id");
  if (!id || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1e3 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const message = enc.encode(id + "." + timestamp + "." + body);
  for (const candidate of (req.headers.get("webhook-signature") || "").split(" ")) {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(candidate)) continue;
    const bytes = Uint8Array.from(atob(candidate.slice(3)), (char) => char.charCodeAt(0));
    if (await crypto.subtle.verify("HMAC", key, bytes, message)) return true;
  }
  return false;
}
async function receivePayment(req, env) {
  if (req.method !== "POST") return json({ error: "M\xE9thode non autoris\xE9e." }, 405);
  if (!configured(env)) return json({ error: "Int\xE9gration indisponible." }, 503);
  if (+String(req.headers.get("Content-Length")) > 25e4) return json({}, 413);
  const body = await req.text();
  if (body.length > 25e4) return json({}, 413);
  if (!await validSignature(req, body, env.WHOP_WEBHOOK_SECRET)) return json({}, 401);
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return json({}, 400);
  }
  if (event.type !== "payment.succeeded" || (event.account_id && event.account_id !== env.WHOP_ACCOUNT_ID) || !isPaymentId(event.data?.id)) return json({ received: true });
  const p = await api(env, "/payments/" + event.data.id);
  const ref = p.metadata?.bro_order;
  if (p.id !== event.data.id || (p.status && p.status !== "paid") || !p.paid_at ||
      p.refunded_at || p.auto_refunded || Number(p.refunded_amount||0)>0 ||
      (p.account_id??p.company?.id??p.company_id)!==env.WHOP_ACCOUNT_ID) return json({ received: true });
  const attributed=typeof ref==='string'&&/^[a-f0-9-]{36}$/.test(ref);
  const saved=attributed?await env.BUCKET.get("private/orders/" + ref):null;
  const order=saved?await saved.json():null;
  const paymentVariant=p.variant?.id??p.variant_id??p.plan?.id??p.plan_id;
  const paymentCheckout=p.checkout_configuration?.id??p.checkout_configuration_id;
  if(order?.fulfillmentVersion===2&&(!/^ch_[a-zA-Z0-9]+$/.test(order.checkoutId||'')||planForPayment(p)!==order.planId))return json({received:true});
  if(order && ((planForPayment(p)&&planForPayment(p)!==order.planId) || (paymentVariant&&paymentVariant!==order.variant) ||
      (paymentCheckout&&paymentCheckout!==order.checkoutId)))
    return json({received:true});
  // Direct Whop plan links have no Bro checkout metadata. They are still
  // genuine payments, eligible for the activity feed and staff notification,
  // but must never grant a Discord entitlement without a verified order.
  const planId=order?.planId??planForPayment(p);
  if(!planId)return json({received:true});
  const amount = Number(p.amount_charged?.amount??p.total);
  const currency = String(p.amount_charged?.currency ?? p.currency ?? 'EUR').toUpperCase();
  const date = p.paid_at;
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Date.parse(date))) return json({}, 502);
  let fulfillmentPending=false;
  const invoice = { id: p.id, title: order?.title??({day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'}[planId]), date, amount, currency, pdfUrl: "/api/invoices/" + p.id + "/pdf" };
  if(order?.discordId&&!await reservePaymentOwner(env.BUCKET,p.id,order.discordId))return json({received:true});
  if(order?.owner)await env.BUCKET.put("private/invoices/" + order.owner + "/" + p.id, JSON.stringify(invoice));
  // Un rôle ne peut être octroyé qu'à un compte Discord lié AVANT le paiement.
  if (typeof order?.discordId === 'string' && /^\d{17,20}$/.test(order.discordId)) {
    const expiresAt=expiryForPlan(order.planId,date);
    if (expiresAt!==undefined) {
      await env.BUCKET.put("private/discord-entitlements/" + order.discordId + "/" + p.id,
        JSON.stringify({paymentId:p.id,expiresAt,planId:order.planId}));
      if(order.fulfillmentVersion===2)try{const result=await queuePaidKey(env.BUCKET,{discordId:order.discordId,paymentId:p.id,planId:order.planId,expiresAt});if(result.status==='unconfigured'||result.status==='unverified'||result.status==='conflict')fulfillmentPending=true;}catch(error){fulfillmentPending=true;console.error('License allocation pending',{reason:['inventory_conflict','storage_revision_unavailable','invalid_inventory','Key encryption not configured'].includes(error?.message)?error.message:'storage_or_allocation_error',type:error?.constructor?.name??'Error'});}
      try { await reconcileMember(env.BUCKET,order.discordId); }
      catch (e) { console.error('Discord role sync pending',e.name); }
    }
  }
  // Consent can be withdrawn between checkout and the signed webhook.
  const displayConsent=order?.discordId&&await getActivityPreference(env.BUCKET,order.discordId);
  let profile=null;
  if(order?.discordId)try{profile=await readAccount(env.BUCKET,order.discordId);}catch{}
  const verifiedIdentity=profile?{username:profile.displayName,avatar:profile.avatar}:order?.identity??order?.publicIdentity;
  const record=normalizePayment(p,planId,{
    accountId:env.WHOP_ACCOUNT_ID,
    visible:!!verifiedIdentity&&displayConsent===true,
    username:verifiedIdentity?.username,
    avatar:verifiedIdentity?.avatar
  });
  if(record) {
    // Private verified attribution survives opt-out so the purchaser can
    // choose to show or hide their OWN profile later in the account area.
    if(/^\d{17,20}$/.test(order?.discordId||''))record.discordId=order.discordId;
    await storeActivity(env.BUCKET,record);
  }
  // Staff notifications always run even if the public community webhook is down.
  const notification=await notifyVerifiedPurchase(env.BUCKET,order??{planId},p,{accountId:env.WHOP_ACCOUNT_ID});
  if(record){
    const publicNotice=await sendPublicPurchase(env.BUCKET,record);
    if(publicNotice.configured&&!publicNotice.ok)
      console.error('Community activity notification pending',{planId});
  }
  // Request a retry when the private staff channel has a temporary failure.
  if(fulfillmentPending||notification.configured&&!notification.ok)return json({error:'fulfillment_or_notification_pending'},503);
  return json({ received: true });
}
async function hasConfirmedPurchase(env,userId) {
  if (!userId)return false;
  const page=await env.BUCKET.list({prefix:"private/invoices/"+await ownerKey(userId)+"/",limit:1});
  return page.objects.length>0;
}
async function handleBilling(req, env, userId, customerLabel) {
  const url = new URL(req.url);
  if (url.pathname === "/api/whop/webhook") return receivePayment(req, env);
  if (url.pathname !== "/api/invoices" && !url.pathname.startsWith("/api/invoices/")) return null;
  if (req.method !== "GET") return json({}, 405);
  if (!userId) return json({ error: "Connexion requise." }, 401);
  const prefix = "private/invoices/" + await ownerKey(userId) + "/";
  if (url.pathname === "/api/invoices") {
    const cursor = url.searchParams.get("cursor") || void 0;
    const page = await env.BUCKET.list({ prefix, limit: 30, cursor });
    const invoices = await Promise.all(page.objects.filter((obj) => obj.key.startsWith(prefix)).map(async (obj) => {
      const id=obj.key.slice(prefix.length),entry=await env.BUCKET.get(obj.key);
      return entry?normalizePurchaseReceipt(await entry.json(),id):null;
    }));
    const sorted = invoices.filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date));
    return json({ mode: "synced", invoices: sorted, nextCursor: page.truncated ? page.cursor : null });
  }
  const receiptId=url.pathname.match(/^\/api\/invoices\/(pay_[A-Za-z0-9]{1,160})\/receipt\.pdf$/)?.[1];
  if(receiptId){
    const entry=await env.BUCKET.get(prefix+receiptId);
    const record=entry?normalizePurchaseReceipt(await entry.json(),receiptId):null;
    if(!record)return json({},404);
    const pdf=purchaseReceiptPdf(record,customerLabel||'Compte BRO');
    return new Response(pdf,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="BRO-achat-'+receiptId+'.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  const id = url.pathname.match(/^\/api\/invoices\/(pay_[A-Za-z0-9]+)\/pdf$/)?.[1];
  if (!id || !await env.BUCKET.head(prefix + id)) return json({}, 404);
  const entry=await env.BUCKET.get(prefix+id);
  if(entry&&(await entry.json()).provider==='tebex')return json({error:'Facture disponible via Tebex.'},404);
  const pdf = await api(env, "/payments/" + id + "/generate_pdf", { method: "POST" });
  const target = new URL(pdf.url);
  if (target.protocol !== "https:" || !/(^|\.)whop\.com$/.test(target.hostname) || target.username || target.password) return json({}, 502);
  return new Response(null, { status: 303, headers: { Location: target.href, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
export {
  createCheckout,
  handleBilling,
  hasConfirmedPurchase
};
