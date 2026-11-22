import {expiryForPlan,reconcileMember} from './discord.mjs';
import {notifyVerifiedPurchase} from './purchase-notify.mjs';
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
  const response = await fetch(apiBase + path, { ...init, redirect: "error", headers: {
    Authorization: "Bearer " + env.WHOP_API_KEY,
    "Api-Version-Date": "2026-11-20",
    "Content-Type": "application/json"
  } });
  if (!response.ok) throw Error("Whop est temporairement indisponible.");
  return response.json();
}
async function ownerKey(userId) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(userId));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
async function createCheckout(env, user, plan, origin) {
  const {id:userId,discordId}=user||{};
  if (!userId) throw Error("Connexion requise.");
  const link = whopUrl(plan.checkoutUrl);
  const variant = link.pathname.split("/").find((part) => /^plan_[A-Za-z0-9]+$/.test(part));
  if (!configured(env) || !variant) return link.href;
  const ref = crypto.randomUUID();
  const owner = await ownerKey(userId);
  const checkout = await api(env, "/checkout_configurations", { method: "POST", body: JSON.stringify({
    account_id: env.WHOP_ACCOUNT_ID,
    variant_id: variant,
    mode: "payment",
    redirect_url: new URL("/#compte", origin).href,
    metadata: { bro_order: ref }
  }) });
  if (checkout.account_id !== env.WHOP_ACCOUNT_ID || checkout.variant?.id !== variant || !/^ch_[A-Za-z0-9]+$/.test(checkout.id)) throw Error("Offre Whop indisponible.");
  const terms = checkout.variant;
  const listedPrice = terms.billing_type === "renewal" ? terms.renewal_price : terms.initial_price;
  if (String(terms.currency).toLowerCase() !== "eur" || Number(listedPrice) !== plan.price)
    throw Error("Le tarif Whop diff\xE8re du tarif affich\xE9. Le paiement est suspendu.");
  const target = whopUrl(checkout.purchase_url);
  const showPublic=await getActivityPreference(env.BUCKET,discordId);
  const order = { owner, discordId, planId: plan.id, title: plan.name, variant, checkoutId: checkout.id,
    publicIdentity:showPublic?{username:user.discordUsername,avatar:user.discordAvatar}:null };
  await env.BUCKET.put("private/orders/" + ref, JSON.stringify(order));
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
  if (event.type !== "payment.succeeded" || event.account_id !== env.WHOP_ACCOUNT_ID || !isPaymentId(event.data?.id)) return json({ received: true });
  const p = await api(env, "/payments/" + event.data.id);
  const ref = p.metadata?.bro_order;
  if (p.id !== event.data.id || p.status !== "paid" ||
      (p.account_id??p.company?.id)!==env.WHOP_ACCOUNT_ID) return json({ received: true });
  const attributed=typeof ref==='string'&&/^[a-f0-9-]{36}$/.test(ref);
  const saved=attributed?await env.BUCKET.get("private/orders/" + ref):null;
  const order=saved?await saved.json():null;
  if(order && (p.variant_id!==order.variant ||
      (p.checkout_configuration_id&&p.checkout_configuration_id!==order.checkoutId)))
    return json({received:true});
  // Direct Whop plan links have no Bro checkout metadata. They are still
  // genuine payments, eligible for the activity feed and staff notification,
  // but must never grant a Discord entitlement without a verified order.
  const planId=order?.planId??planForProduct(p.product?.id);
  if(!planId)return json({received:true});
  const amount = Number(p.amount_charged?.amount);
  const currency = String(p.amount_charged?.currency ?? "").toUpperCase();
  const date = p.paid_at;
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Date.parse(date))) return json({}, 502);
  const invoice = { id: p.id, title: order.title, date, amount, currency, pdfUrl: "/api/invoices/" + p.id + "/pdf" };
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
  const record=normalizePayment(p,planId,{
    visible:!!order?.publicIdentity,
    username:order?.publicIdentity?.username,
    avatar:order?.publicIdentity?.avatar
  });
  if(record) {
    if(record.publicIdentity&&order?.discordId)record.discordId=order.discordId;
    await storeActivity(env.BUCKET,record);
    const publicNotice=await sendPublicPurchase(env.BUCKET,record);
    if(publicNotice.configured&&!publicNotice.ok)return json({error:'public_notification_pending'},503);
  }
  const notification=await notifyVerifiedPurchase(env.BUCKET,order??{planId},p);
  // If configured but temporarily unavailable, ask Whop to retry its signed event.
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
