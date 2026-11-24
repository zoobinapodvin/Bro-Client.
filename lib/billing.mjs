import {expiryForPlan,reconcileMember} from './discord.mjs';
import {notifyVerifiedPurchase,planForPayment} from './purchase-notify.mjs';
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
    owner,discordId,planId:plan.id,title:plan.name,variant,
    createdAt:new Date().toISOString(),
    identity:{username:user.discordUsername,avatar:user.discordAvatar}
  };
  // Save FIRST, so a confirmed webhook cannot outrun the order record.
  await env.BUCKET.put('private/orders/'+ref,JSON.stringify(order),{onlyIf:{etagDoesNotMatch:'*'}});
  const checkout=await api(env,'/checkout_configurations',{
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
  if(order && ((paymentVariant&&paymentVariant!==order.variant) ||
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
  const invoice = { id: p.id, title: order?.title??({day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'}[planId]), date, amount, currency, pdfUrl: "/api/invoices/" + p.id + "/pdf" };
  if(order?.owner)await env.BUCKET.put("private/invoices/" + order.owner + "/" + p.id, JSON.stringify(invoice));
  // Un rôle ne peut être octroyé qu'à un compte Discord lié AVANT le paiement.
  if (typeof order?.discordId === 'string' && /^\d{17,20}$/.test(order.discordId)) {
    const expiresAt=expiryForPlan(order.planId,date);
    if (expiresAt!==undefined) {
      await env.BUCKET.put("private/discord-entitlements/" + order.discordId + "/" + p.id,
        JSON.stringify({paymentId:p.id,expiresAt,planId:order.planId}));
      try { await reconcileMember(env.BUCKET,order.discordId); }
      catch (e) { console.error('Discord role sync pending',e.name); }
    }
  }
  // Consent can be withdrawn between checkout and the signed webhook.
  const displayConsent=order?.discordId&&await getActivityPreference(env.BUCKET,order.discordId);
  const verifiedIdentity=order?.identity??order?.publicIdentity;
  const record=normalizePayment(p,planId,{
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
  const notification=await notifyVerifiedPurchase(env.BUCKET,order??{planId},p);
  if(record){
    const publicNotice=await sendPublicPurchase(env.BUCKET,record);
    if(publicNotice.configured&&!publicNotice.ok)
      console.error('Community activity notification pending',{planId});
  }
  // Request a retry when the private staff channel has a temporary failure.
  if(notification.configured&&!notification.ok)return json({error:'notification_pending'},503);
  return json({ received: true });
}
async function hasConfirmedPurchase(env,userId) {
  if (!configured(env) || !userId)return false;
  const page=await env.BUCKET.list({prefix:"private/invoices/"+await ownerKey(userId)+"/",limit:1});
  return page.objects.length>0;
}
async function handleBilling(req, env, userId) {
  const url = new URL(req.url);
  if (url.pathname === "/api/whop/webhook") return receivePayment(req, env);
  if (url.pathname !== "/api/invoices" && !url.pathname.startsWith("/api/invoices/")) return null;
  if (req.method !== "GET") return json({}, 405);
  if (!userId) return json({ error: "Connexion requise." }, 401);
  const prefix = "private/invoices/" + await ownerKey(userId) + "/";
  if (url.pathname === "/api/invoices") {
    if (!configured(env)) return json({ mode: "portal", invoices: [], nextCursor: null });
    const cursor = url.searchParams.get("cursor") || void 0;
    const page = await env.BUCKET.list({ prefix, limit: 30, cursor });
    const invoices = await Promise.all(page.objects.filter((obj) => obj.key.startsWith(prefix)).map(async (obj) => (await env.BUCKET.get(obj.key))?.json()));
    const sorted = invoices.filter((v) => Boolean(v)).sort((a, b) => b.date.localeCompare(a.date));
    return json({ mode: "synced", invoices: sorted, nextCursor: page.truncated ? page.cursor : null });
  }
  const id = url.pathname.match(/^\/api\/invoices\/(pay_[A-Za-z0-9]+)\/pdf$/)?.[1];
  if (!id || !await env.BUCKET.head(prefix + id)) return json({}, 404);
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
