import { createPublicKey, verify as ed25519Verify } from 'node:crypto';
import {assignKey} from './fulfillment.mjs';

// Le bot Discord fonctionne par interactions HTTPS : aucun WebSocket permanent sur Vercel.
const discordApi='https://discord.com/api/v10';
const snowflake=v=>typeof v==='string' && /^\d{17,20}$/.test(v);
const staffKeyChannel='1574104734124605460';
const settings=()=>({
  token:process.env.BRO_DISCORD_BOT_TOKEN,
  guild:process.env.BRO_DISCORD_GUILD_ID,
  role:process.env.BRO_DISCORD_CUSTOMER_ROLE_ID,
  lifetimeRole:process.env.BRO_DISCORD_LIFETIME_ROLE_ID,
  application:process.env.BRO_DISCORD_APPLICATION_ID,
  publicKey:process.env.BRO_DISCORD_PUBLIC_KEY
});
export const botConfigured=()=>{const s=settings();return !!(s.token&&snowflake(s.guild)&&snowflake(s.role)&&snowflake(s.lifetimeRole)&&s.role!==s.lifetimeRole);};
export function discordIdentityId(identity){
  const candidate=identity?.provider_id ?? identity?.identity_data?.sub ?? identity?.identity_data?.id;
  return snowflake(candidate)?candidate:null;
}
const prefix=id=>'private/discord-entitlements/'+id+'/';
const validExpiry=s=>typeof s==='string' && Number.isFinite(Date.parse(s));
const active=entry=>entry && !entry.revokedAt && (entry.expiresAt===null || (validExpiry(entry.expiresAt)&&Date.parse(entry.expiresAt)>Date.now()));
export async function entitlement(bucket,id){
  if(!snowflake(id))return {paid:false,ever:false};
  let cursor,ever=false,paid=false,lifetime=false;
  for(let pageNumber=0;pageNumber<10;pageNumber++){
    const page=await bucket.list({prefix:prefix(id),limit:100,cursor});
    for(const item of page.objects){
      if(!item.key.startsWith(prefix(id)))continue;
      const itemData=await bucket.get(item.key);
      if(!itemData)continue;
      ever=true;
      const purchase=await itemData.json();
      if(active(purchase)){
        paid=true;
        if(purchase.planId==='life')lifetime=true;
      }
    }
    if(!page.truncated||!page.cursor)break;
    cursor=page.cursor;
  }
  return {paid,ever,lifetime};
}
async function discordRequest(path,options={}){
  const s=settings();
  if(!s.token)throw Error('Bot non configuré');
  const response=await fetch(discordApi+path,{
    method:options.method||'GET',
    headers:{Authorization:'Bot '+s.token,'Content-Type':'application/json'},
    body:options.body?JSON.stringify(options.body):undefined,
    redirect:'error',signal:AbortSignal.timeout(2500)
  });
  if(!response.ok && !(response.status===404&&options.allow404)){
    console.error('Discord REST failed',response.status,path.split('/').slice(0,3).join('/'));
    throw Error(response.status===403?'permissions':'discord_'+response.status);
  }
  return response;
}
export async function reconcileMember(bucket,id){
  if(!snowflake(id))return {status:'identity_missing'};
  if(!botConfigured())return {status:'bot_unconfigured'};
  const {paid,ever,lifetime}=await entitlement(bucket,id);
  if(!ever)return {status:'no_purchase'};
  const s=settings();
  const memberPath='/guilds/'+s.guild+'/members/'+id+'/roles/';
  try {
    const customer=await discordRequest(memberPath+s.role,{method:paid?'PUT':'DELETE',allow404:true});
    if(customer.status===404)return {status:'not_member'};
    const premium=await discordRequest(memberPath+s.lifetimeRole,{method:lifetime?'PUT':'DELETE',allow404:true});
    if(premium.status===404)return {status:'not_member'};
    return {status:paid?(lifetime?'role_granted_lifetime':'role_granted'):'role_expired'};
  }catch(error){return {status:error.message==='permissions'?'insufficient_permissions':'discord_unavailable'};}
}
export function expiryForPlan(id,paidAt){
  const hours={day:24,week:168,month:720};
  if(id==='life')return null;
  const duration=hours[id];
  const date=Date.parse(paidAt);
  return duration&&Number.isFinite(date)?new Date(date+duration*3600000).toISOString():undefined;
}
export async function registerCommands(){
  const s=settings();
  if(!botConfigured()||!snowflake(s.application))return {status:'bot_unconfigured'};
  await discordRequest('/applications/'+s.application+'/guilds/'+s.guild+'/commands',{
    method:'PUT',body:[{name:'bro',description:'Compte et accès Bro Client',type:1,
    options:[{name:'statut',description:'Vérifier le bot Bro Client',type:1},
             {name:'acces',description:'Synchroniser ton rôle client après un achat',type:1}]},
    {name:'startkey',description:'Attribuer une clé à un acheteur vérifié',type:1,
     default_member_permissions:'8',
     options:[
       {name:'acheteur',description:'Client Discord dont l’achat est vérifié',type:6,required:true},
       {name:'cle',description:'Clé privée à attribuer (ne sera pas publiée)',type:3,required:true,min_length:5,max_length:256}
     ]}]
  });
  return {status:'registered'};
}
const message=(content)=>({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
export async function handleInteraction(req,res,raw,bucket){
  const s=settings();
  const timestamp=req.headers['x-signature-timestamp'];
  const signature=req.headers['x-signature-ed25519'];
  if(!s.publicKey||!/^[a-f0-9]{64}$/i.test(s.publicKey)||!/^\d{10}$/.test(timestamp||'')||
    Math.abs(Date.now()/1000-Number(timestamp))>300||!/^[a-f0-9]{128}$/i.test(signature||''))
    return res.status(401).end();
  let valid=false;
  try {
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(s.publicKey,'hex')]),format:'der',type:'spki'});
    valid=ed25519Verify(null,Buffer.concat([Buffer.from(timestamp),raw]),key,Buffer.from(signature,'hex'));
  } catch {valid=false;}
  if(!valid)return res.status(401).end();
  let event;
  try {event=JSON.parse(raw.toString());}catch{return res.status(400).end();}
  if(event.type===1)return res.json({type:1});
  if(event.type!==2)return res.json(message('Commande non reconnue.'));
  if(event.guild_id!==s.guild)return res.json(message('Ce bot est réservé au serveur Bro Client.'));
  if(event.data?.name==='startkey'){
    const authorized=process.env.BRO_DISCORD_OWNER_USER_ID;
    const actor=event.member?.user?.id??event.user?.id;
    if(!authorized||!snowflake(authorized)||actor!==authorized||event.channel_id!==staffKeyChannel)
      return res.json(message('Commande réservée au propriétaire, dans le salon de livraison des clés.'));
    const opts=event.data.options||[];
    const buyer=opts.find(x=>x.name==='acheteur')?.value;
    const key=opts.find(x=>x.name==='cle')?.value;
    const result=await assignKey(bucket,{discordId:buyer,key,operatorId:actor});
    const labels={
      assigned:'Clé attribuée. Le client peut la copier ou la télécharger depuis son espace Bro Client.',
      no_purchase:'Aucun achat actif vérifié pour cet utilisateur Discord. Aucune clé créée.',
      already_assigned:'Une clé existe déjà pour ce client. Aucune modification effectuée.',
      unconfigured:'Le stockage sécurisé des clés est indisponible.',
      invalid:'Utilisateur ou clé invalide.'
    };
    return res.json(message(labels[result.status]||'Attribution non effectuée.'));
  }
  if(event.data?.name!=='bro')return res.json(message('Commande non reconnue.'));
  const sub=event.data.options?.[0]?.name;
  if(sub==='statut')return res.json(message(botConfigured()?'Bot Bro Client prêt à gérer les rôles.':'Bot en attente de configuration.'));
  if(sub==='acces'){
    const id=event.member?.user?.id??event.user?.id;
    // Le Discord ID est garanti par la signature Ed25519 de Discord.
    const result=await reconcileMember(bucket,id);
    const notes={
      role_granted:'Ton rôle Customer est maintenant synchronisé.',
      role_granted_lifetime:'Tes rôles Customer et Lifetime sont maintenant synchronisés.',
      role_expired:'Ton accès est expiré et le rôle client a été retiré.',
      no_purchase:'Aucun achat associé à ce compte Discord. Connecte-toi sur broclient.com avant un futur achat.',
      not_member:'Rejoins le serveur Bro Client puis réessaie.',
      bot_unconfigured:'Le bot est encore en cours de configuration.',
      insufficient_permissions:'Le bot ne peut pas attribuer le rôle. Contacte le support.',
      discord_unavailable:'Discord est momentanément indisponible. Réessaie.',
      identity_missing:'Identité Discord indisponible.'
    };
    return res.json(message(notes[result.status]||'Synchronisation indisponible.'));
  }
  return res.json(message('Essaie /bro statut ou /bro acces.'));
}
export async function reconcileExpiredRoles(bucket){
  if(!botConfigured())return {status:'bot_unconfigured'};
  let cursor,checked=0,updated=0;
  const seen=new Set();
  for(let page=0;page<15;page++){
    const batch=await bucket.list({prefix:'private/discord-entitlements/',limit:100,cursor});
    for(const item of batch.objects){
      const id=item.key.split('/')[2];
      if(!snowflake(id)||seen.has(id))continue;
      seen.add(id);
      const state=await entitlement(bucket,id);
      if(state.ever){
        const result=await reconcileMember(bucket,id);
        checked++;if(['role_expired','role_granted','role_granted_lifetime'].includes(result.status))updated++;
      }
    }
    if(!batch.truncated||!batch.cursor)break;
    cursor=batch.cursor;
  }
  return {status:'checked',checked,updated};
}
