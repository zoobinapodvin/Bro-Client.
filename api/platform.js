import {bucket} from '../lib/storage.mjs';
import {readSite,saveSite,upload} from '../lib/store.mjs';
import {session,credentials,clear,destination} from '../lib/auth.mjs';
import {createCheckout,handleBilling} from '../lib/billing.mjs';
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
    if(req.method==='POST'&&!isWebhook&&req.headers.origin!==origin)return res.status(403).end();
    const site=()=>readSite(bucket);
    if(path==='/api/site'&&req.method==='GET'){
      const {site:config,revision}=await site();return res.json({...config,revision});
    }
    if(path==='/auth/login'&&req.method==='GET')return res.redirect(302,'/connexion.html?return_to='+encodeURIComponent(destination(parsed.searchParams.get('return_to'))));
    if(path==='/auth/logout'&&req.method==='GET'){clear(res);return res.redirect(303,'/');}
    const payload=req.method==='POST'?await body(req,path==='/api/media'?4*1024*1024:isWebhook?250000:100000):undefined;
    if(['/auth/session','/auth/register','/auth/recover','/auth/exchange','/auth/password'].includes(path)&&req.method==='POST')return await credentials(req,res,path.split('/').pop(),JSON.parse(payload.toString()));
    if(/^\/media\/[a-f0-9-]{36}$/.test(path)&&req.method==='GET'){
      const img=await bucket.get(route);if(!img)return res.status(404).end();
      res.setHeader('Content-Type',img.httpMetadata.contentType);res.setHeader('Cache-Control','public, max-age=31536000, immutable');return res.end(Buffer.from(await new Response(img.body).arrayBuffer()));
    }
    const user=isWebhook?null:await session(req,res);
    if(path==='/api/me'&&req.method==='GET')return res.json({user:user?{email:user.email,admin:user.admin}:null});
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
      if(!plan?.checkoutUrl)return res.redirect(302,'/#tarifs');
      return res.redirect(302,user ? await createCheckout(billingEnv,user.id,plan,origin) : plan.checkoutUrl);
    }
    return res.status(404).end();
  } catch(e){if(e instanceof RangeError)return res.status(413).end();if(e instanceof SyntaxError)return res.status(400).end();console.error('Bro Client request failed',path,e.name);return res.status(503).json({error:'Service momentanément indisponible.'});}
}
