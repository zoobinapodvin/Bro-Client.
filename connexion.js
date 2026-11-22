const form=document.querySelector('form'),message=document.querySelector('[role=status]'),toggle=document.querySelector('#toggle'),forgot=document.querySelector('#forgot');
const email=form.elements.email,password=form.elements.password,submit=form.querySelector('button');
const heading=document.querySelector('h1');
const titles={session:'Connexion',register:'Créer un compte',recover:'Mot de passe oublié',password:'Nouveau mot de passe'};
let mode='session';
const params=new URLSearchParams(location.search);
function display(next){
 mode=next;message.textContent='';heading.textContent=titles[mode];
 email.parentElement.hidden=mode==='password';email.required=!email.parentElement.hidden;
 password.parentElement.hidden=mode==='recover';password.required=!password.parentElement.hidden;
 password.autocomplete=['register','password'].includes(mode)?'new-password':'current-password';password.minLength=['register','password'].includes(mode)?10:1;
 submit.textContent={session:'Se connecter',register:'Créer mon compte',recover:'Recevoir le lien',password:'Enregistrer le mot de passe'}[mode];
 toggle.textContent=mode==='session'?'Créer un compte':'Revenir à la connexion';forgot.hidden=mode!=='session';
}
async function call(action,data){
 const r=await fetch('/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Demande indisponible. Réessaie.');return d;
}
toggle.onclick=()=>display(mode==='session'?'register':'session');forgot.onclick=()=>display('recover');
form.onsubmit=async e=>{
 e.preventDefault();submit.disabled=toggle.disabled=forgot.disabled=true;
 try{
  const d=await call(mode,{email:email.value,password:password.value});
  if(d.ok){location.assign('/#compte');return;}
  display('session');
  message.textContent=d.sent?'Si un compte utilise cette adresse, un lien de récupération va être envoyé. Ouvre-le dans ce navigateur.':'Si ton adresse est nouvelle, ouvre le lien de confirmation reçu par e-mail. Si tu as déjà un compte, connecte-toi ou choisis « Mot de passe oublié ».';
 }catch(err){message.textContent=err.message;}finally{submit.disabled=toggle.disabled=forgot.disabled=false;}
};
(async()=>{
 const code=params.get('code'),error=params.get('error_description')||new URLSearchParams(location.hash.slice(1)).get('error_description');
 if(code||error)history.replaceState(null,'',location.pathname);
 if(error){message.textContent='Ce lien a expiré ou a déjà été utilisé. Tu peux demander un nouveau lien.';return;}
 if(!code)return;
 try{submit.disabled=true;const d=await call('exchange',{code});if(d.recovery)display('password');else location.assign('/#compte');}
 catch(e){message.textContent=e.message;}finally{submit.disabled=false;}
})();
