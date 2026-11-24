import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {bucket} from '../lib/storage.mjs';
import {readSite,saveSite,upload} from '../lib/store.mjs';
import {canEditHomepage,readHomepage,saveHomepage} from '../lib/homepage.mjs';
import {session,exchange,startDiscord,clear,disconnectDiscord,destination} from '../lib/auth.mjs';
import {createCheckout,handleBilling,hasConfirmedPurchase,attachVerifiedPayment,recoverAttributedPayment} from '../lib/billing.mjs';
import {authenticatedCheckoutDestination,validWhopPlan} from '../lib/checkout.mjs';
import {registerAccount,listAccounts,findAccount,readAccount} from '../lib/accounts.mjs';
import {botConfigured,reconcileMember,registerCommands,handleInteraction,reconcileExpiredRoles} from '../lib/discord.mjs';
import {communityStats} from '../lib/community.mjs';
import {accountOverview,readCustomerKey,ownerStockPath,stockOverview,addStockKey,revealStockKey,importStockKeys} from '../lib/fulfillment.mjs';
import {recentPurchases,getActivityPreference,setActivityPreference,backfillWhopHistory,sendHistoricalSummary,rebuildRecentIndex} from '../lib/activity.mjs';
import {canEditPatchnotes,listPatchnotes,readPatchnote,editPatchnote} from '../lib/patchnotes.mjs';
import {reconcilePaymentNotifications} from '../lib/purchase-notify.mjs';
import {completeTebexPayment} from '../lib/tebex.mjs';
import {canReadCustomerGuides,readCustomerGuideCatalog,renderCustomerGuides,CUSTOMER_GUIDES_KEY} from '../lib/customer-guides.mjs';
// Profile persistence must never block authentication or the checkout route.
async function rememberAccount(user){
 try{return await registerAccount(bucket,user);}catch(error){console.error('Bro account registry unavailable',error?.name);return null;}
}
// Owner explicitly resumed confirmed-payment fulfillment. Emergency env override remains available.
process.env.BRO_KEY_DELIVERY_PAUSED ??= 'false';
const billingEnv={BUCKET:bucket,WHOP_API_KEY:process.env.WHOP_API_KEY,WHOP_ACCOUNT_ID:process.env.WHOP_ACCOUNT_ID,WHOP_WEBHOOK_SECRET:process.env.WHOP_WEBHOOK_SECRET,WHOP_CHECKOUT_API_KEY:process.env.WHOP_CHECKOUT_API_KEY};
async function body(req,max) {
  const chunks=[];let size=0;
  for await(const part of req){const buf=Buffer.from(part);size+=buf.length;if(size>max)throw new RangeError();chunks.push(buf);}
  return Buffer.concat(chunks);
}
async function respond(res,result) {
  res.statusCode=result.status;
  for(const [key,value] of result.headers)res.setHeader(key,value);
  res.end(Buffer.from(await result.arrayBuffer()));
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const origin='https://'+req.headers.host;
  const parsed=new URL(req.url,origin);
  const route=parsed.searchParams.get('route')??parsed.pathname.slice(1);
  const path='/'+route;
  try {
    // Tebex endpoint: validate the raw signature before processing any event.
    if(path==='/api/webhooks/tebex'){
      if(req.method!=='POST'){
        res.setHeader('Allow','POST');
        return res.status(405).end();
      }
      const secret=process.env.TEBEX_WEBHOOK_SECRET;
      if(!secret)return res.status(503).json({error:'Webhook not configured'});
      const raw=await body(req,250000);
      const signature=req.headers['x-signature'];
      if(typeof signature!=='string'||!/^[a-f0-9]{64}$/i.test(signature))
        return res.status(401).end();
      const expected=createHmac('sha256',secret)
        .update(createHash('sha256').update(raw).digest('hex')).digest();
      if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))
        return res.status(401).end();
      const event=JSON.parse(raw.toString('utf8'));
      if(event?.type==='validation.webhook'&&typeof event.id==='string'&&event.id.length>0&&event.id.length<=200)
        return res.status(200).json({id:event.id});
      const result=await completeTebexPayment(bucket,event);
      return res.status(result.status).json(result.body);
    }
    if(path==='/api/ops/reconcile-sales'&&req.method==='POST'){
      const token=process.env.BRO_SALES_RECONCILE_TOKEN;
      if(!token||req.headers.authorization!=='Bearer '+token)return res.status(403).end();
      const result=await reconcilePaymentNotifications(bucket,{apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID,date:'twoDays',limit:60});
      return res.json(result);
    }
    const isWebhook=path==='/api/whop/webhook';
    const isInteraction=path==='/api/discord/interactions';
    const isDiscordStart=path==='/auth/discord';
    // OAuth can begin via a standard top-level GET. Allow the previous POST form
    // temporarily for browsers that still have an older, cached connexion.html.
    // Other mutations remain protected by an exact same-origin POST check.
    const trustedLoginOrigin=['https://www.broclient.com','https://broclient.com'].includes(req.headers.origin);
    if(req.method==='POST'&&!isWebhook&&!isInteraction &&
       !(isDiscordStart&&trustedLoginOrigin) && req.headers.origin!==origin)
      return res.status(403).json({error:'Origine de la requête non autorisée.'});
    const site=()=>readSite(bucket);
    if(path==='/api/discord/community'&&req.method==='GET'){
      const counts=await communityStats();
      res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=300');
      return res.json(counts);
    }
    if(path==='/api/activity'&&req.method==='GET'){
      // Never contact Whop during a visitor's request; the signed webhook and cron maintain receipts.
      res.setHeader('Cache-Control','private, no-store');
      return res.json({purchases:await recentPurchases(bucket),sync:{state:'ok'}});
    }
    if(path==='/api/homepage'&&req.method==='GET'){
      res.setHeader('Cache-Control','public, s-maxage=3, max-age=0, must-revalidate');
      return res.json(await readHomepage(bucket));
    }
    if(path==='/api/site'&&req.method==='GET'){
      const {site:config,revision}=await site();return res.json({...config,revision});
    }
    if(path==='/auth/discord-return'&&req.method==='GET'){
      res.setHeader('Referrer-Policy','no-referrer');
      const code=parsed.searchParams.get('code');
      if(!code)return res.redirect(303,parsed.searchParams.has('error')?'/?connexion=interrompue#compte':'/#compte');
      try{return await exchange(req,res,{code},true,rememberAccount);}
      catch{return res.redirect(303,'/?connexion=indisponible#compte');}
    }
    if(path==='/auth/login'&&req.method==='GET'){
      const next=destination(parsed.searchParams.get('return_to'));
      return next==='/#compte'?res.redirect(303,next):res.redirect(303,'/auth/discord?return_to='+encodeURIComponent(next));
    }
    if(isDiscordStart&&req.method==='GET')
      return startDiscord(res,parsed.searchParams.get('return_to'));
    if(path==='/auth/logout'&&req.method==='GET'){clear(res);return res.redirect(303,'/');}
    const payload=req.method==='POST'?await body(req,
      path==='/api/admin/release'?4*1024*1024:(path==='/api/media'||path==='/api/homepage/media')?4*1024*1024:isWebhook?250000:100000):undefined;
    if(isInteraction&&req.method==='POST')return handleInteraction(req,res,payload,bucket);
    if(path==='/api/discord/cron'&&req.method==='GET'){
      const secret=process.env.CRON_SECRET;
      if(!secret||req.headers.authorization!=='Bearer '+secret)return res.status(401).end();
      const roles=await reconcileExpiredRoles(bucket);
      let notifications=null;
      try{await backfillWhopHistory(bucket,{apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID,maxPages:2});await rebuildRecentIndex(bucket);}catch(error){console.error('Activity background refresh failed',error?.name);}
      try{
        notifications=await reconcilePaymentNotifications(bucket,{
          apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID,
          date:'twoDays',limit:24,onVerifiedPayment:payment=>recoverAttributedPayment(billingEnv,payment)
        });
      }catch(error){console.error('Discord purchase recovery failed',error?.name);}
      return res.json({roles,notifications});
    }
    if(path==='/auth/unlink'&&req.method==='POST')return disconnectDiscord(req,res);
    if(path==='/auth/discord'&&req.method==='POST')return startDiscord(res,new URLSearchParams(payload.toString()).get('return_to'));
    if(path==='/auth/exchange'&&req.method==='POST')return await exchange(req,res,JSON.parse(payload.toString()),false,rememberAccount);

    if(/^\/media\/[a-f0-9-]{36}$/.test(path)&&req.method==='GET'){
      const img=await bucket.get(route);if(!img)return res.status(404).end();
      res.setHeader('Content-Type',img.httpMetadata.contentType);res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(Buffer.from(await new Response(img.body).arrayBuffer()));
    }
    const user=isWebhook?null:await session(req,res);
    if((path==='/api/homepage'||path==='/api/homepage/media')&&req.method==='POST'){
      if(!canEditHomepage(user))return res.status(403).json({error:'Accès propriétaire requis.'});
      if(path.endsWith('/media'))return await respond(res,await upload(new Request(new URL(path,origin),{method:'POST',headers:req.headers,body:payload}),bucket));
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({error:'Format JSON requis.'});
      let patch;try{patch=JSON.parse(payload.toString());}catch{return res.status(400).json({error:'Contenu illisible.'});}
      return await respond(res,await saveHomepage(bucket,user,req.headers['if-match'],patch));
    }
    if(/^\/guides(?:\.html|\/[a-z-]+(?:\.html)?)?$/.test(path)&&req.method==='GET'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag','noindex, nofollow');
      if(!await canReadCustomerGuides(bucket,user))return res.status(user?403:401).end(renderCustomerGuides());
      const catalog=await readCustomerGuideCatalog(bucket);
      return res.end(renderCustomerGuides(catalog.guides));
    }
    if(/^\/gestion-cles\/commande\/pay_[A-Za-z0-9]+$/.test(path)&&req.method==='GET'){
      const ownerPath=ownerStockPath(user);
      if(!ownerPath)return res.status(404).end();
      res.setHeader('Referrer-Policy','no-referrer');
      return res.redirect(303,ownerPath+'?payment='+encodeURIComponent(path.split('/').pop()));
    }
    if(path.startsWith('/gestion-cles/')){
      const privatePath=ownerStockPath(user);
      if(!privatePath||!(path===privatePath||path===privatePath+'/stock'))return res.status(404).end();
      res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
      if(path===privatePath&&req.method==='GET'){
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end("<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>BRO. · Key Management</title><link rel=\"stylesheet\" href=\"/key-stock.css?v=5\"><script defer src=\"/xlsx-stock.js?v=5\"></script><script defer src=\"/key-stock.js?v=5\"></script></head><body><aside class=\"sidebar\"><a class=\"brand\" href=\"/#compte\">BRO<span>.</span><small>CONTROL CENTER</small></a><div class=\"nav-caption\">GESTION PRIVÉE</div><nav id=\"nav\" aria-label=\"Catégories du stock\"><button data-plan=\"all\" aria-current=\"page\"><span>▦</span> Vue globale</button><button data-plan=\"day\"><span>◷</span> 1 jour <b id=\"nav-day\">—</b></button><button data-plan=\"week\"><span>◷</span> 1 semaine <b id=\"nav-week\">—</b></button><button data-plan=\"month\"><span>◷</span> 1 mois <b id=\"nav-month\">—</b></button><button data-plan=\"life\"><span>∞</span> Lifetime <b id=\"nav-life\">—</b></button><button data-plan=\"legacy\"><span>↺</span> Historique</button></nav><div class=\"sidebar-bottom\"><div class=\"secure\"><i></i><div><strong>Accès propriétaire</strong><small>Session Discord vérifiée</small></div></div><a href=\"/#compte\" class=\"back\">← Espace client</a></div></aside><main><div class=\"topbar\"><span>Administration <span class=\"slash\">/</span> Licences</span><span class=\"private-tag\"><i></i> Privé · Chiffré</span></div><header class=\"hero\"><div><div class=\"eyebrow\">BRO CLIENT / INVENTAIRE</div><h1 id=\"heading\">Gestion des clés</h1><p id=\"subtitle\">Pilote tes licences et les commandes depuis un seul espace.</p></div><button id=\"refresh\" type=\"button\" class=\"secondary\">↻ Actualiser</button></header><div id=\"banner\" role=\"status\" class=\"banner\" hidden></div><section id=\"summary\" class=\"summary\" aria-label=\"Stock par pass\"><div class=\"skeleton\"></div><div class=\"skeleton\"></div><div class=\"skeleton\"></div><div class=\"skeleton\"></div></section><section class=\"panel add-panel\"><div class=\"section-head\"><div><div class=\"eyebrow\">01 / APPROVISIONNEMENT</div><h2>Ajouter une clé</h2><p>La clé est chiffrée et vérifiée avant son enregistrement.</p></div><span class=\"chip\">AES-256-GCM</span></div><form id=\"stock-form\"><label>Type de pass<select id=\"plan\"><option value=\"day\">1 jour</option><option value=\"week\">1 semaine</option><option value=\"month\">1 mois</option><option value=\"life\">Lifetime</option></select></label><label class=\"key-field\">Clé de licence<div class=\"input-wrap\"><input id=\"key\" type=\"password\" autocomplete=\"off\" spellcheck=\"false\" required minlength=\"5\" maxlength=\"256\" placeholder=\"Saisir la clé de licence\"><button id=\"toggle-key\" type=\"button\" class=\"plain\" aria-label=\"Afficher la clé\">Afficher</button></div></label><button id=\"add\" class=\"primary\" type=\"submit\"><span>＋</span> Ajouter au stock</button></form><div id=\"status\" role=\"status\" class=\"form-status\"></div><details class=\"bulk-import\"><summary>Importer un stock depuis Excel</summary><div class=\"xlsx-upload\"><h3>Importer directement un fichier .xlsx</h3><p>Les feuilles Day, Semaine, Month et Lifetime sont reconnues automatiquement. Les clés restent dans ton navigateur jusqu’à confirmation.</p><label>Fichier Excel<input id=\"xlsx-file\" type=\"file\" accept=\".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\"></label><div id=\"xlsx-preview\" role=\"status\" class=\"form-status\"></div><button id=\"xlsx-confirm\" type=\"button\" class=\"primary\" disabled>Confirmer l’import du fichier</button><div id=\"xlsx-result\" role=\"status\" class=\"form-status\"></div></div><p>Ou utiliser le copier-coller manuel :</p><p>Copie les deux colonnes Clé et Type d’une seule feuille, sans son en-tête. Les statuts Vendu et les statuts manquants ne seront jamais distribués.</p><form id=\"import-form\"><label>Catégorie<select id=\"import-plan\"><option value=\"day\">1 jour</option><option value=\"week\">1 semaine</option><option value=\"month\">1 mois</option><option value=\"life\">Lifetime</option></select></label><label>Clés et statuts<textarea id=\"import-rows\" rows=\"5\" required autocomplete=\"off\" spellcheck=\"false\" placeholder=\"Colle ici les deux colonnes Excel\"></textarea></label><button id=\"import-submit\" type=\"submit\" class=\"primary\">Importer et verrouiller</button></form><div id=\"import-status\" role=\"status\" class=\"form-status\"></div></details></section><section class=\"panel\"><div class=\"section-head\"><div><div class=\"eyebrow\">02 / COMMANDES</div><h2>En attente de livraison <span id=\"pending-count\" class=\"count\">—</span></h2><p>Paiements vérifiés en attente d’une clé disponible.</p></div></div><div id=\"pending\" class=\"table-wrap\"><div class=\"empty\">Chargement des commandes…</div></div></section><section class=\"panel\"><div class=\"section-head\"><div><div class=\"eyebrow\">03 / INVENTAIRE</div><h2 id=\"inventory-title\">Toutes les clés</h2><p>Les clés sont masquées par défaut. Consulte-les individuellement.</p></div><span id=\"row-count\" class=\"chip\">—</span></div><div class=\"filters\"><input id=\"search\" type=\"search\" placeholder=\"Rechercher une référence, un paiement, un compte Discord…\" aria-label=\"Rechercher\"><select id=\"state\" aria-label=\"Statut\"><option value=\"all\">Tous les statuts</option><option value=\"available\">Disponibles</option><option value=\"assigned\">Attribuées</option><option value=\"expired\">Expirées</option><option value=\"legacy\">Historiques</option><option value=\"sold\">Vendues (import)</option><option value=\"quarantine\">À vérifier</option></select></div><div id=\"inventory\" class=\"table-wrap\"><div class=\"empty\">Chargement du stock…</div></div><div class=\"pagination\" id=\"pagination\"></div></section><footer> BRO. — Gestion sécurisée des licences <span>Ne partage jamais les clés de stock.</span></footer></main><dialog id=\"key-dialog\"><div class=\"section-head\"><div><div class=\"eyebrow\">ACCÈS PROPRIÉTAIRE</div><h2>Clé de licence</h2></div><button id=\"close-dialog\" type=\"button\" class=\"secondary\">Fermer</button></div><p id=\"key-detail\"></p><input id=\"revealed\" readonly aria-label=\"Clé de licence\"><div class=\"dialog-actions\"><button id=\"copy-key\" type=\"button\" class=\"primary\">Copier la clé</button><span id=\"copy-status\" role=\"status\"></span></div></dialog></body></html>");
      }
      if(path===privatePath+'/stock'&&req.method==='GET')return res.json(await stockOverview(bucket));
      if(path===privatePath+'/stock'&&req.method==='POST'){
        const input=JSON.parse(payload.toString());const result=await addStockKey(bucket,{planId:input.planId,key:input.key,operatorId:user.discordId});
        return res.status(result.status==='added'?201:result.status==='duplicate'?409:422).json(result);
      }
      return res.status(405).end();
    }
    // Stable same-origin API; the secret URL is only the entry point, not the authorization.
    if(path==='/api/admin/key-stock'||path==='/api/admin/key-stock/reveal'||path==='/api/admin/key-stock/import'){
      if(!ownerStockPath(user))return res.status(404).json({error:'Accès propriétaire requis.'});
      res.setHeader('Referrer-Policy','no-referrer');
      if(path==='/api/admin/key-stock'&&req.method==='GET')return res.json(await stockOverview(bucket));
      if(req.method!=='POST')return res.status(405).end();
      const input=JSON.parse(payload.toString());
      if(path.endsWith('/reveal')){
        const key=await revealStockKey(bucket,user,input?.id);
        return key?res.json({key}):res.status(404).json({error:'Clé introuvable.'});
      }
      const result=path.endsWith('/import')?await importStockKeys(bucket,{planId:input?.planId,rows:input?.rows,operatorId:user.discordId}):await addStockKey(bucket,{planId:input?.planId,key:input?.key,operatorId:user.discordId});
      if(!['added','imported'].includes(result.status))return res.status(result.status==='duplicate'?409:422).json(result);
      // Do not report a committed insertion as failed if a subsequent read fails.
      let overview=null;try{overview=await stockOverview(bucket);}catch(error){console.error('Stock refresh pending',error?.name);}
      return res.status(201).json({...result,overview});
    }
    if(path==='/api/patchnotes' || /^\/api\/patchnotes\/[a-z0-9-]+$/.test(path)){
      const editor=canEditPatchnotes(user);
      res.setHeader('Cache-Control','no-store');
      if(req.method==='GET'){
        const slug=path==='/api/patchnotes'?null:path.split('/').pop();
        if(slug){
          const note=await readPatchnote(bucket,slug,{admin:editor});
          return note?res.json({note,editor}):res.status(404).json({error:'Mise à jour introuvable.'});
        }
        return res.json({notes:await listPatchnotes(bucket,{admin:editor}),editor});
      }
      if(req.method!=='POST'||path!=='/api/patchnotes')return res.status(405).end();
      if(!editor)return res.status(403).json({error:'Publication réservée au compte Discord autorisé.'});
      const result=await editPatchnote(bucket,JSON.parse(payload.toString()));
      return res.status(result.status).json(result);
    }
    if(path==='/api/me'&&req.method==='GET'){
      const [account,overview]=user?await Promise.all([rememberAccount(user),accountOverview(bucket,user).catch(error=>{console.error('Overview preload unavailable',error?.name);return null;})]):[null,null];
      const guideAccess=overview?.hasPurchase===true;
      return res.json({overview,user:user?{
      username:account?.username??null,
      discordUsername:user.discordUsername,
      discordAvatar:user.discordAvatar,
      guideAccess,homeEditor:canEditHomepage(user),admin:user.admin,patchnotesAdmin:canEditPatchnotes(user),discordLinked:!!user.discordId,stockPath:ownerStockPath(user)
    }:null});
    }
    if(path==='/api/admin/accounts'&&req.method==='GET'){
      if(!canEditPatchnotes(user))return res.status(403).end();
      return res.json(await listAccounts(bucket,parsed.searchParams.get('cursor')));
    }
    if(path==='/api/admin/payments/attach'&&req.method==='POST'){
      if(!canEditPatchnotes(user))return res.status(403).end();
      // This is a staff-only reconciliation, never an automatic claim by payment ID.
      const input=JSON.parse(payload.toString());
      if(input?.confirmed!==true||typeof input.paymentId!=='string'||typeof input.account!=='string')return res.status(422).json({error:'Confirme la vérification du justificatif et du compte Discord.'});
      const account=await findAccount(bucket,input.account);
      if(!account)return res.status(404).json({error:'Compte introuvable. Le client doit se reconnecter à Bro Client.'});
      try{
        const result=await attachVerifiedPayment(billingEnv,account,input.paymentId,user.discordId);
        return res.status(result.status==='linked'?200:409).json(result);
      }catch(error){console.error('Bro payment reconciliation failed',error?.name);return res.status(503).json({error:'Impossible de vérifier le paiement auprès de Whop.'});}
    }
    if(path==='/api/admin/notifications/replay-today'&&req.method==='POST'){
      if(!canEditPatchnotes(user))return res.status(403).json({error:'Accès réservé au propriétaire Discord.'});
      if(!billingEnv.WHOP_API_KEY||!billingEnv.WHOP_ACCOUNT_ID)
        return res.status(503).json({error:'Vérifie les identifiants Whop dans Vercel.'});
      const result=await reconcilePaymentNotifications(bucket,{
        apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID,
        date:'today',limit:60,onVerifiedPayment:payment=>recoverAttributedPayment(billingEnv,payment)
      });
      return res.status(result.status==='whop_error'?502:200).json(result);
    }
    if(path==='/api/account/publicity'){
      if(!user?.discordId)return res.status(401).end();
      if(req.method==='GET')return res.json({showPublic:await getActivityPreference(bucket,user.discordId)});
      if(req.method==='POST'){
        const choice=JSON.parse(payload.toString());
        if(typeof choice?.showPublic!=='boolean')return res.status(422).end();
        let profile=null;try{profile=await readAccount(bucket,user.discordId);}catch{}
        return res.json(await setActivityPreference(bucket,{...user,username:profile?.displayName??user.discordUsername,discordAvatar:profile?.avatar??user.discordAvatar},choice.showPublic));
      }
      return res.status(405).end();
    }
    if(path==='/api/admin/activity/backfill'&&req.method==='POST'){
      if(!user?.admin)return res.status(403).end();
      if(!billingEnv.WHOP_API_KEY)return res.status(503).json({error:'Connecte la clé API Whop dans Vercel.'});
      const result=await backfillWhopHistory(bucket,{apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID,onVerifiedPayment:payment=>recoverAttributedPayment(billingEnv,payment)});
      if(result.imported>0)result.discordSummary=await sendHistoricalSummary(bucket,result);
      return res.json(result);
    }
    if(path==='/api/account/overview'&&req.method==='GET'){
      if(!user)return res.status(401).json({error:'Connecte-toi avec Discord.'});
      return res.json(await accountOverview(bucket,user));
    }
    if(path==='/api/account/key'&&req.method==='GET'){
      if(!user?.discordId)return res.status(401).end();
      const key=await readCustomerKey(bucket,user.discordId,parsed.searchParams.get('payment'));
      return key?res.json({key}):res.status(404).json({error:'Clé indisponible.'});
    }
    if(path==='/api/account/key.txt'&&req.method==='GET'){
      if(!user?.discordId)return res.status(401).end();
      const key=await readCustomerKey(bucket,user.discordId,parsed.searchParams.get('payment'));
      if(!key)return res.status(404).end();
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename="BroClient-key.txt"');
      return res.end('BRO CLIENT — Clé privée\\r\\n'+key+'\\r\\n');
    }
    // The former launcher is no longer distributed or accepted for publication.
    if(path==='/api/account/download'||path==='/api/admin/release'){
      res.setHeader('Cache-Control','no-store');
      return res.status(410).json({error:'La distribution du launcher a été arrêtée.'});
    }
    if(path==='/api/discord/status'&&req.method==='GET'){
      if(!user)return res.status(401).end();
      return res.json({botConfigured:botConfigured(),discordLinked:!!user.discordId,paymentsConfigured:!!(billingEnv.WHOP_API_KEY&&billingEnv.WHOP_ACCOUNT_ID&&billingEnv.WHOP_WEBHOOK_SECRET)});
    }
    if(path==='/api/discord/sync'&&req.method==='POST'){
      if(!user)return res.status(401).json({error:'Connexion Discord requise.'});
      if(!user.discordId)return res.status(422).json({status:'identity_missing'});
      return res.json(await reconcileMember(bucket,user.discordId));
    }
    if(path==='/api/discord/register'&&req.method==='POST'){
      if(!user?.admin)return res.status(403).end();
      return res.json(await registerCommands());
    }
    if(path==='/api/guides'){
      if(!user)return res.status(401).json({error:'Connexion requise.'});
      const key=CUSTOMER_GUIDES_KEY;
      if(req.method==='GET'){
        if(!user.admin&&!await canReadCustomerGuides(bucket,user))return res.status(403).json({error:'Achat vérifié requis.'});
        return res.json(await readCustomerGuideCatalog(bucket));
      }
      if(req.method==='POST'){
        if(!user.admin)return res.status(403).end();
        const {guides}=JSON.parse(payload.toString());
        if(!Array.isArray(guides)||guides.length>80||guides.some(g=>typeof g?.title!=='string'||!g.title.trim()||g.title.length>180||typeof g.body!=='string'||!g.body.trim()||g.body.length>30000))return res.status(422).json({error:'Renseigne le titre et le contenu de chaque guide.'});
        const rev=req.headers['if-match'];if(!rev)return res.status(428).end();
        const onlyIf=rev==='initial'?{etagDoesNotMatch:'*'}:{etagMatches:rev};
        const stored=await bucket.put(key,JSON.stringify(guides.map(({title,body})=>({title,body}))),{onlyIf});
        return stored?res.json({revision:stored.etag}):res.status(409).json({error:'Catalogue modifié dans une autre session.'});
      }
    }
    const url=new URL(path,origin);if(parsed.searchParams.has('cursor'))url.searchParams.set('cursor',parsed.searchParams.get('cursor'));
    const request=new Request(url,{method:req.method,headers:req.headers,body:payload});
    const invoice=await handleBilling(request,billingEnv,user?.id??null);if(invoice)return await respond(res,invoice);
    if((path==='/api/site'||path==='/api/media')&&req.method==='POST'){
      if(!canEditHomepage(user))return res.status(403).json({error:'Accès administrateur requis.'});
      if(path==='/api/site'&&!req.headers['if-match'])return res.status(428).json({error:'Recharge la page avant de modifier le site.'});
      return await respond(res,path==='/api/site'?await saveSite(request,bucket):await upload(request,bucket));
    }
    if(/^\/checkout\/(day|week|month|life)$/.test(path)&&req.method==='GET'){
      const planId=path.split('/').pop();
      const refParam=parsed.searchParams.get('tebex_order');
      if(!user?.discordId||!/^\d{17,20}$/.test(user.discordId))
        return res.redirect(303,'/auth/discord?return_to='+encodeURIComponent(path));
      try{
        const packageId={day:'7832046',week:'7832045',month:'7832044',life:'7832042'}[planId];
        const token=process.env.TEBEX_PUBLIC_TOKEN?.trim();
        if(!token||!process.env.TEBEX_WEBHOOK_SECRET)throw Error('tebex_not_configured');
        const api='https://headless.tebex.io/api';
        const account='/accounts/'+encodeURIComponent(token);
        const owner=createHash('sha256').update(String(user.id)).digest('hex');
        const call=async (path,body)=>{
          const r=await fetch(api+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Accept':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(8000)});
          const result=await r.json().catch(()=>({}));
          if(!r.ok){
            const error=Error('tebex_http_'+r.status);
            error.loginRequired=r.status===422&&/user must login|login before|log in before|authentication required/i.test(JSON.stringify({message:result.message,detail:result.detail,errors:result.errors,title:result.title}));
            throw error;
          }
          return result.data??result;
        };
        const targetUrl=(raw,auth=false)=>{
          const target=new URL(raw??'');
          const allowed=auth?(target.hostname==='tebex.io'||target.hostname.endsWith('.tebex.io')):['checkout.tebex.io','pay.tebex.io'].includes(target.hostname);
          if(target.protocol!=='https:'||!allowed||target.username||target.password||target.port)throw Error('tebex_redirect_invalid');
          return target.href;
        };
        let ref,basket,order,orderKey;
        if(refParam!==null){
          if(!/^[a-f0-9-]{36}$/.test(refParam))throw Error('tebex_order_invalid');
          ref=refParam;orderKey='private/tebex/orders/'+ref+'.json';
          const stored=await bucket.get(orderKey);
          order=stored?await stored.json():null;
          if(!order||order.provider!=='tebex'||order.planId!==planId||order.packageId!==packageId||order.discordId!==user.discordId||order.owner!==owner||
            !Number.isFinite(Date.parse(order.createdAt))||Date.now()-Date.parse(order.createdAt)>60*60*1000)throw Error('tebex_order_invalid');
          basket=await call(account+'/baskets/'+encodeURIComponent(order.basketId));
          if(basket.ident!==order.basketId||basket.complete===true)throw Error('tebex_basket_mismatch');
        }else{
          ref=crypto.randomUUID();orderKey='private/tebex/orders/'+ref+'.json';
          basket=await call(account+'/baskets',{
            complete_url:'https://www.broclient.com/#compte',
            cancel_url:'https://www.broclient.com/offres',
            complete_auto_redirect:true,
            custom:{bro_order:ref}
          });
          if(typeof basket.ident!=='string'||!/^[A-Za-z0-9-]{10,128}$/.test(basket.ident))throw Error('tebex_basket_invalid');
          order={provider:'tebex',planId,packageId,basketId:basket.ident,discordId:user.discordId,owner,createdAt:new Date().toISOString()};
          if(!await bucket.put(orderKey,JSON.stringify(order),{onlyIf:{etagDoesNotMatch:'*'}}))throw Error('tebex_order_not_saved');
        }
        const pkg=await call(account+'/packages/'+packageId);
        if(String(pkg.id)!==packageId)throw Error('tebex_package_mismatch');
        const ident=typeof pkg.ident==='string'&&pkg.ident?pkg.ident:packageId;
        let filled=basket;
        if(Array.isArray(basket.packages)&&basket.packages.length){
          if(basket.packages.length!==1||String(basket.packages[0].id??basket.packages[0].package?.id)!==packageId||Number(basket.packages[0].in_basket?.quantity??basket.packages[0].quantity??1)!==1)throw Error('tebex_basket_contents_mismatch');
        }else{
          try{filled=await call('/baskets/'+encodeURIComponent(basket.ident)+'/packages',{package_id:ident,quantity:1});}
          catch(error){
            if(!error.loginRequired||refParam!==null)throw error;
            const callback='https://www.broclient.com'+path+'?tebex_order='+encodeURIComponent(ref);
            const providers=await call(account+'/baskets/'+encodeURIComponent(basket.ident)+'/auth?returnUrl='+encodeURIComponent(callback));
            if(!Array.isArray(providers)||!providers.length)throw Error('tebex_auth_unavailable');
            const urls=providers.map(p=>targetUrl(p.url,true));
            res.setHeader('Referrer-Policy','no-referrer');
            return res.redirect(303,urls[0]);
          }
        }
        if(filled.ident!==basket.ident||filled.complete===true)throw Error('tebex_basket_mismatch');
        const target=targetUrl(filled.links?.checkout);
        res.setHeader('Referrer-Policy','no-referrer');
        return res.redirect(303,target);
      }catch(error){
        console.error('Tebex checkout unavailable',{plan:planId,reason:String(error?.message||'unknown').slice(0,80)});
        return res.redirect(303,'/offres?paiement=indisponible');
      }
    }
    return res.status(404).end();
  } catch(e){if(e instanceof RangeError)return res.status(413).end();if(e instanceof SyntaxError)return res.status(400).end();console.error('Bro Client request failed',path,e.name);return res.status(503).json({error:'Service momentanément indisponible.'});}
}
