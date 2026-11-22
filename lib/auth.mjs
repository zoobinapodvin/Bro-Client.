import {randomBytes,createHash} from 'node:crypto';
import {discordIdentityId} from './discord.mjs';
const base='https://izzqsgszyvkibmkdruvj.supabase.co/auth/v1/';
const key=process.env.BRO_DISCORD_SUPABASE_PUBLISHABLE_KEY;
const adminEmail='n7umber@icloud.com';
export function destination(value) {
  return /^\/checkout\/(day|week|month|life)$/.test(value)?value:'/#compte';
}
function writeCookie(res,name,value,age) {
  res.appendHeader('Set-Cookie',name+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age);
}
function token(req,name) {
  return (req.headers.cookie||'').split(/;\s*/).find(c=>c.startsWith(name+'='))?.slice(name.length+1);
}
async function auth(path,payload,access) {
  return fetch(base+path,{method:payload?'POST':'GET',headers:{apikey:key,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},body:payload?JSON.stringify(payload):undefined,redirect:'error'});
}
function setSession(res,data) {
  writeCookie(res,'__Host-bro-discord-a',data.access_token,data.expires_in||3600);
  writeCookie(res,'__Host-bro-discord-r',data.refresh_token,2592000);
}
export function clear(res) {for(const k of ['__Host-bro-discord-a','__Host-bro-discord-r'])writeCookie(res,k,'',0);}
function profile(u) {
  const identity=u?.identities?.find(i=>i.provider==='discord');
  if(!u?.id || !u.email_confirmed_at || !identity || u.is_anonymous)return null;
  const verified=identity.identity_data?.email_verified===true && identity.identity_data.email?.toLowerCase()===adminEmail;
  return {id:u.id,email:u.email,discordId:discordIdentityId(identity),admin:verified && u.email?.toLowerCase()===adminEmail};
}
export async function session(req,res) {
  const access=token(req,'__Host-bro-discord-a');
  if(access){const response=await auth('user',null,access);if(response.ok)return profile(await response.json());if(response.status>=500)throw Error('auth');}
  const refresh=token(req,'__Host-bro-discord-r');
  if(!refresh)return null;
  const response=await auth('token?grant_type=refresh_token',{refresh_token:refresh});
  if(!response.ok){if(response.status>=500)throw Error('auth');return null;}
  const data=await response.json();setSession(res,data);return profile(data.user);
}
export function startDiscord(res) {
  if(!key)return res.redirect(303,'/connexion.html?status=unavailable');
  const verifier=randomBytes(48).toString('base64url');
  const url=new URL('authorize',base);
  url.search=new URLSearchParams({
    provider:'discord',scopes:'identify email',redirect_to:'https://www.broclient.com/connexion.html',
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256'
  });
  writeCookie(res,'__Host-bro-discord-proof',verifier,600);
  return res.redirect(303,url.href);
}
export async function exchange(req,res,body) {
  const verifier=token(req,'__Host-bro-discord-proof');
  if(!key||!verifier||typeof body?.code!=='string'||body.code.length>1000)return res.status(400).json({error:'Relance la connexion avec Discord dans ce navigateur.'});
  writeCookie(res,'__Host-bro-discord-proof','',0);
  const response=await auth('token?grant_type=pkce',{auth_code:body.code,code_verifier:verifier});
  if(!response.ok)return res.status(400).json({error:'Connexion expirée. Réessaie avec Discord.'});
  const data=await response.json();
  if(!profile(data.user))return res.status(403).json({error:'Vérifie ton adresse dans Discord puis reconnecte-toi.'});
  setSession(res,data);
  return res.json({ok:true});
}
