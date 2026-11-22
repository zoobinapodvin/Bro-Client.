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
  const {email,password}=body;
  if(typeof email!=='string'||email.length>320||typeof password!=='string'||!password||password.length>512)return res.status(400).json({error:'Vérifie ton adresse e-mail et ton mot de passe.'});
  const signUp=action==='register';
  if(signUp&&password.length<10)return res.status(400).json({error:'Utilise au moins 10 caractères.'});
  const path=signUp?'signup?redirect_to='+encodeURIComponent('https://broclient.com/connexion.html'):'token?grant_type=password';
  const response=await auth(path,{email,password});
  if(!response.ok)return res.status(response.status===429?429:400).json({error:response.status===429?'Trop de tentatives. Réessaie plus tard.':signUp?'Inscription indisponible. Essaie de te connecter si tu as déjà un compte.':'Identifiants incorrects ou adresse e-mail à confirmer.'});
  const data=await response.json();
  if(data.access_token&&profile(data.user)){setSession(res,data);return res.json({ok:true});}
  if(signUp)return res.json({confirm:true});
  return res.status(403).json({error:'Confirme ton adresse e-mail avant de te connecter.'});
}
