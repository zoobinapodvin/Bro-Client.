import {bucket} from '../lib/storage.mjs';
import {readSite,saveSite,upload} from '../lib/store.mjs';
import {session,exchange,startDiscord,clear,disconnectDiscord,destination} from '../lib/auth.mjs';
import {createCheckout,handleBilling,hasConfirmedPurchase} from '../lib/billing.mjs';
import {botConfigured,reconcileMember,registerCommands,handleInteraction,reconcileExpiredRoles} from '../lib/discord.mjs';
import {communityStats} from '../lib/community.mjs';
import {accountOverview,hasActivePurchase,readCustomerKey,storeRelease,RELEASE_PATH} from '../lib/fulfillment.mjs';
import {recentPurchases,getActivityPreference,setActivityPreference,backfillWhopHistory,sendHistoricalSummary} from '../lib/activity.mjs';
const billingEnv={BUCKET:bucket,WHOP_API_KEY:process.env.WHOP_API_KEY,WHOP_ACCOUNT_ID:process.env.WHOP_ACCOUNT_ID,WHOP_WEBHOOK_SECRET:process.env.WHOP_WEBHOOK_SECRET};
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
      // Receipts only: no anonymous payments are ever bound to Discord accounts.
      // A durable throttle also prevents API errors from triggering repeated
      // expensive upstream requests on every visitor's 15-second poll.
      const marker='private/activity/whop-feed-refresh-v2.json';
      const previous=await bucket.get(marker);
      let last=previous?await previous.json().catch(()=>null):null;
      const configured=Boolean(billingEnv.WHOP_API_KEY&&billingEnv.WHOP_ACCOUNT_ID);
      let sync=configured?(last?.status??'pending'):'not_configured';
      if(configured&&(!last?.at||Date.now()-Date.parse(last.at)>90000)){
        const at=new Date().toISOString();
        try{
          const report=await backfillWhopHistory(bucket,{
            apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID,maxPages:2
          });
          sync=report.status==='ok'?'ok':'pending';
          last={at,status:sync,checked:report.reviewed??0,imported:report.imported??0};
        }catch(error){
          console.error('Whop activity refresh failed',error?.message);
          sync='error';last={at,status:sync};
        }
        try{await bucket.put(marker,JSON.stringify(last));}catch(error){
          console.error('Whop activity refresh marker failed',error?.name);
        }
      }
      res.setHeader('Cache-Control','no-store');
      return res.json({purchases:await recentPurchases(bucket),
        sync:{state:sync,checkedAt:last?.at??null}});
    }
    if(path==='/api/site'&&req.method==='GET'){
      const {site:config,revision}=await site();return res.json({...config,revision});
    }
    if(path==='/auth/login'&&req.method==='GET')return res.redirect(302,'/connexion.html?return_to='+encodeURIComponent(destination(parsed.searchParams.get('return_to'))));
    if(isDiscordStart&&req.method==='GET')
      return startDiscord(res,parsed.searchParams.get('return_to'));
    if(path==='/auth/logout'&&req.method==='GET'){clear(res);return res.redirect(303,'/');}
    const payload=req.method==='POST'?await body(req,
      path==='/api/admin/release'?4*1024*1024:path==='/api/media'?4*1024*1024:isWebhook?250000:100000):undefined;
    if(isInteraction&&req.method==='POST')return handleInteraction(req,res,payload,bucket);
    if(path==='/api/discord/cron'&&req.method==='GET'){
      const secret=process.env.CRON_SECRET;
      if(!secret||req.headers.authorization!=='Bearer '+secret)return res.status(401).end();
      return res.json(await reconcileExpiredRoles(bucket));
    }
    if(path==='/auth/unlink'&&req.method==='POST')return disconnectDiscord(req,res);
    if(path==='/auth/discord'&&req.method==='POST')return startDiscord(res,new URLSearchParams(payload.toString()).get('return_to'));
    if(path==='/auth/exchange'&&req.method==='POST')return await exchange(req,res,JSON.parse(payload.toString()));

    if(/^\/media\/[a-f0-9-]{36}$/.test(path)&&req.method==='GET'){
      const img=await bucket.get(route);if(!img)return res.status(404).end();
      res.setHeader('Content-Type',img.httpMetadata.contentType);res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(Buffer.from(await new Response(img.body).arrayBuffer()));
    }
    const user=isWebhook?null:await session(req,res);
    if(path==='/api/me'&&req.method==='GET')return res.json({user:user?{
      discordUsername:user.discordUsername,
      discordAvatar:user.discordAvatar,
      admin:user.admin,discordLinked:!!user.discordId
    }:null});
    if(path==='/api/account/publicity'){
      if(!user?.discordId)return res.status(401).end();
      if(req.method==='GET')return res.json({showPublic:await getActivityPreference(bucket,user.discordId)});
      if(req.method==='POST'){
        const choice=JSON.parse(payload.toString());
        if(typeof choice?.showPublic!=='boolean')return res.status(422).end();
        return res.json(await setActivityPreference(bucket,user,choice.showPublic));
      }
      return res.status(405).end();
    }
    if(path==='/api/admin/activity/backfill'&&req.method==='POST'){
      if(!user?.admin)return res.status(403).end();
      if(!billingEnv.WHOP_API_KEY)return res.status(503).json({error:'Connecte la clé API Whop dans Vercel.'});
      const result=await backfillWhopHistory(bucket,{apiKey:billingEnv.WHOP_API_KEY,accountId:billingEnv.WHOP_ACCOUNT_ID});
      if(result.imported>0)result.discordSummary=await sendHistoricalSummary(bucket,result);
      return res.json(result);
    }
    if(path==='/api/account/overview'&&req.method==='GET'){
      if(!user)return res.status(401).json({error:'Connecte-toi avec Discord.'});
      return res.json(await accountOverview(bucket,user));
    }
    if(path==='/api/account/key'&&req.method==='GET'){
      if(!user?.discordId)return res.status(401).end();
      const key=await readCustomerKey(bucket,user.discordId);
      return key?res.json({key}):res.status(404).json({error:'Clé indisponible.'});
    }
    if(path==='/api/account/key.txt'&&req.method==='GET'){
      if(!user?.discordId)return res.status(401).end();
      const key=await readCustomerKey(bucket,user.discordId);
      if(!key)return res.status(404).end();
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename="BroClient-key.txt"');
      return res.end('BRO CLIENT — Clé privée\\r\\n'+key+'\\r\\n');
    }
    if(path==='/api/account/download'&&req.method==='GET'){
      if(!user?.discordId)return res.status(401).end();
      if(!await hasActivePurchase(bucket,user.discordId))return res.status(403).end();
      const file=await bucket.get(RELEASE_PATH);
      if(!file)return res.status(404).json({error:'Le programme sera bientôt disponible.'});
      res.setHeader('Content-Type','application/octet-stream');
      res.setHeader('Content-Disposition','attachment; filename="BroClient.exe"');
      res.setHeader('X-Content-Type-Options','nosniff');
      for await(const chunk of file.body)res.write(chunk);
      return res.end();
    }
    if(path==='/api/admin/release'&&req.method==='POST'){
      if(!user?.admin||!user.discordId)return res.status(403).end();
      const result=await storeRelease(bucket,payload);
      return res.status(result.status==='stored'?201:422).json(result);
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
      const key='guides/catalogue.json';
      if(req.method==='GET'){
        const saved=await bucket.get(key);
        return res.json({guides:saved?await saved.json():[],revision:saved?.etag??'initial'});
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
      if(!user?.admin)return res.status(403).json({error:'Accès administrateur requis.'});
      if(path==='/api/site'&&!req.headers['if-match'])return res.status(428).json({error:'Recharge la page avant de modifier le site.'});
      return await respond(res,path==='/api/site'?await saveSite(request,bucket):await upload(request,bucket));
    }
    if(/^\/checkout\/(day|week|month|life)$/.test(path)&&req.method==='GET'){
      
      const {site:config}=await site();const plan=config.plans.find(p=>path==='/checkout/'+p.id);
      if(!plan?.checkoutUrl)return res.redirect(302,'/offres');
      // A paid checkout must have a verified Discord session. Never fall back
      // to an anonymous Whop plan: that would silently break account linking.
      if(!user?.discordId)return res.redirect(303,'/auth/discord?return_to='+encodeURIComponent('/offres'));
      const target=new URL(plan.checkoutUrl);
      if(target.protocol!=='https:'||!['whop.com','www.whop.com'].includes(target.hostname)||
        !/^\/checkout\/plan_[A-Za-z0-9]+\/?$/.test(target.pathname)||
        target.username||target.password||target.port||target.search||target.hash)
        return res.redirect(302,'/offres');
      try{
        // Preferred: per-session Whop checkout with a server-stored random
        // order ref in metadata, so the signed webhook can identify Discord.
        const attributed=await createCheckout(billingEnv,user,plan,'https://www.broclient.com');
        return res.redirect(302,attributed);
      }catch(error){
        // Keep sales functional if Whop lacks the checkout:create permission.
        // This fallback is NOT linked to Discord and grants no automatic role.
        console.error('Bro checkout attribution unavailable',{
          plan:plan.id,reason:String(error?.message||'unknown').slice(0,90)
        });
        return res.redirect(302,target.href);
      }
    }
    return res.status(404).end();
  } catch(e){if(e instanceof RangeError)return res.status(413).end();if(e instanceof SyntaxError)return res.status(400).end();console.error('Bro Client request failed',path,e.name);return res.status(503).json({error:'Service momentanément indisponible.'});}
}
