import defaults from "../defaults.json" with {type:"json"};
import {validWhopPlan} from "./checkout.mjs";
const key = "config/storefront.json";
async function readSite(bucket) {
  const entry = await bucket.get(key);
  const saved=entry ? await entry.json() : defaults;
  const plans=defaults.plans.map(fallback=>{
    const previous=saved.plans?.find(p=>p.id===fallback.id)??fallback;
    return {...previous,checkoutUrl:saved.checkoutLinksVersion===2?previous.checkoutUrl:fallback.checkoutUrl};
  });
  return {site:{content:{...defaults.content,...saved.content},plans},revision:entry?.etag??"initial"};
}
function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}
function validCheckout(input) {
  if (typeof input !== "string") return false;
  if (input === "") return true;
  try {
    validWhopPlan(input);
    return true;
  } catch {
    return false;
  }
}
function validSite(data) {
  if (!data?.content || !Array.isArray(data.plans) || data.plans.length !== defaults.plans.length) return false;
  for (const key2 of Object.keys(defaults.content)) {
    const value = data.content[key2];
    if (typeof value !== "string" || value.length > 4e3) return false;
    if (/image|logo/i.test(key2) && value && !/^(https:\/\/|\/(media|assets)\/)/i.test(value)) return false;
  }
  return data.plans.every((p, i) => p?.id === defaults.plans[i].id && [p.name, p.duration, p.description].every((v) => typeof v === "string" && v.length < 2e3) && Number.isFinite(p.price) && p.price > 0 && p.price <= 1e5 && validCheckout(p.checkoutUrl));
}
async function readLimited(req, max) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const joined = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    joined.set(chunk, pos);
    pos += chunk.length;
  }
  return joined;
}
async function saveSite(request, bucket) {
  const bytes = await readLimited(request, 1e5);
  if (!bytes) return json({ error: "Contenu trop volumineux." }, 413);
  let site;
  try {
    site = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "Contenu illisible." }, 400);
  }
  if (!validSite(site)) return json({ error: "V\xE9rifiez les tarifs, les textes et les liens Whop." }, 422);
  const revision = request.headers.get("If-Match");
  const check = revision === "initial" ? { etagDoesNotMatch: "*" } : revision ? { etagMatches: revision } : void 0;
  const saved = await bucket.put(key, JSON.stringify({ content: site.content, plans: site.plans, checkoutLinksVersion: 2 }), { onlyIf: check });
  return saved ? json({ ...site, revision: saved.etag }, 200, { "ETag": saved.etag }) : json({ error: "Le site a \xE9t\xE9 modifi\xE9 ailleurs. Rechargez la page avant de r\xE9essayer." }, 409);
}
async function upload(request, bucket) {
  const data = await readLimited(request, 4 * 1024 * 1024);
  if (!data?.length) return json({ error: "Choisissez une image de 4 Mo maximum." }, 413);
  const s = (start, end) => String.fromCharCode(...data.slice(start, end));
  const type = s(0, 8) === "\x89PNG\r\n\n" ? "image/png" : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "image/jpeg" : s(0, 4) === "RIFF" && s(8, 12) === "WEBP" ? "image/webp" : null;
  if (!type) return json({ error: "Utilisez une image PNG, JPEG ou WebP." }, 415);
  const path = "media/" + crypto.randomUUID();
  await bucket.put(path, data, { httpMetadata: { contentType: type } });
  return json({ url: "/" + path }, 201);
}
export {
  json,
  readSite,
  saveSite,
  upload,
  validCheckout
};
