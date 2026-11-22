import {randomBytes,createHash} from 'node:crypto';
const base=process.env.BRO_SUPABASE_URL+'/auth/v1/';
const key=process.env.BRO_SUPABASE_KEY;
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
  writeCookie(res,'__Host-bro-a',data.access_token,data.expires_in||3600);
  writeCookie(res,'__Host-bro-r',data.refresh_token,2592000);
}
export function clear(res) {for(const k of ['__Host-bro-a','__Host-bro-r'])writeCookie(res,k,'',0);}
function profile(u) {
  return u?.id && u.email_confirmed_at && !u.is_anonymous ? {id:u.id,email:u.email,admin:u.email.toLowerCase()===adminEmail}:null;
}
export async function session(req,res) {
  const access=token(req,'__Host-bro-a');
  if(access){const response=await auth('user',null,access);if(response.ok)return profile(await response.json());if(response.status>=500)throw Error('auth');}
  const refresh=token(req,'__Host-bro-r');
  if(!refresh)return null;
  const response=await auth('token?grant_type=refresh_token',{refresh_token:refresh});
  if(!response.ok){if(response.status>=500)throw Error('auth');return null;}
  const data=await response.json();setSession(res,data);return profile(data.user);
}
export async function credentials(req,res,action,body) {
  const email=String(body.email??'').trim();
  const password=body.password;
  const callback='https://www.broclient.com/connexion.html';
  if(action==='exchange'){
    const verifier=token(req,'__Host-bro-proof');
    if(!verifier || typeof body.code!=='string' || body.code.length>1000)return res.status(400).json({error:'Ouvre le lien dans le navigateur utilisé pour la demande.'});
    const response=await auth('token?grant_type=pkce',{auth_code:body.code,code_verifier:verifier});
    if(!response.ok)return res.status(400).json({error:'Lien expiré ou déjà utilisé. Demande un nouveau lien.'});
    const data=await response.json();
    if(!profile(data.user))return res.status(403).end();
    setSession(res,data);
    writeCookie(res,'__Host-bro-proof','',0);
    const recovery=token(req,'__Host-bro-flow')==='recover';writeCookie(res,'__Host-bro-flow','',0);
    return res.json({ok:true,recovery});
  }
  if(action==='password'){
    const access=token(req,'__Host-bro-a');
    if(!access)return res.status(401).json({error:'Ouvre le lien de récupération reçu par e-mail.'});
    if(typeof password!=='string'||password.length<10||password.length>512)return res.status(400).json({error:'Utilise au moins 10 caractères.'});
    const response=await fetch(base+'user',{method:'PUT',headers:{apikey:key,Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({password})});
    return response.ok?res.json({ok:true}):res.status(400).json({error:'Modification impossible. Choisis un nouveau mot de passe et vérifie la validité du lien.'});
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320)return res.status(400).json({error:'Vérifie ton adresse e-mail.'});
  const signUp=action==='register',recover=action==='recover';
  if(!recover&&(typeof password!=='string'||!password||password.length>512))return res.status(400).json({error:'Renseigne ton mot de passe.'});
  if(signUp&&password.length<10)return res.status(400).json({error:'Utilise au moins 10 caractères.'});
  let payload=recover?{email}:{email,password};
  if(signUp||recover){
    const verifier=randomBytes(48).toString('base64url');
    payload.code_challenge=createHash('sha256').update(verifier).digest('base64url');
    payload.code_challenge_method='s256';
    writeCookie(res,'__Host-bro-proof',verifier,3600);
    writeCookie(res,'__Host-bro-flow',recover?'recover':'signup',3600);
  }
  const path=(signUp||recover)?(recover?'recover':'signup')+'?redirect_to='+encodeURIComponent(callback):'token?grant_type=password';
  const response=await auth(path,payload);
  const data=await response.json();
  if(!response.ok){
    const messages={email_not_confirmed:'Confirme ton adresse avec le lien reçu par e-mail.',weak_password:'Choisis un mot de passe plus long et difficile à deviner.',over_email_send_rate_limit:'Un e-mail a déjà été demandé. Patiente avant de réessayer.',user_already_exists:'Un compte existe déjà. Connecte-toi ou utilise « Mot de passe oublié ».',email_address_invalid:'Cette adresse ne peut pas recevoir de message de confirmation.',email_address_not_authorized:'Le service e-mail ne peut pas encore envoyer à cette adresse. Contacte le support Bro Client.'};
    const error=messages[data.code]||(response.status===429?'Trop de tentatives. Réessaie plus tard.':signUp||recover?'Envoi du message impossible. Réessaie ou contacte le support.':'Adresse ou mot de passe incorrect. Utilise « Mot de passe oublié » si nécessaire.');
    return res.status(response.status===429?429:400).json({error});
  }
  if(recover)return res.json({sent:true});
  if(data.access_token&&profile(data.user)){setSession(res,data);return res.json({ok:true});}
  if(signUp)return res.json({confirm:true});
  return res.status(403).json({error:'Confirme ton adresse avant de te connecter.'});
}
