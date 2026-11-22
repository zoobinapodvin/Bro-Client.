const form=document.querySelector('form'), message=document.querySelector('[role=status]'),toggle=document.querySelector('#toggle');
let signup=false;
const back=new URLSearchParams(location.search).get('return_to');
if(location.hash) history.replaceState(null,'',location.pathname+location.search);
toggle.onclick=()=>{
 signup=!signup;message.textContent='';document.querySelector('h1').textContent=signup?'Créer un compte':'Connexion';
 form.password.autocomplete=signup?'new-password':'current-password';form.password.minLength=signup?10:1;
 form.querySelector('button').textContent=signup?'Créer mon compte':'Se connecter';toggle.textContent=signup?'Déjà inscrit ? Se connecter':'Créer un compte';
};
form.onsubmit=async e=>{
 e.preventDefault();const submit=form.querySelector('button');submit.disabled=toggle.disabled=true;
 try{const r=await fetch('/auth/'+(signup?'register':'session'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.email.value,password:form.password.value})});const d=await r.json();
 if(d.ok){location.assign(/^\/checkout\/(day|week|month|life)$/.test(back)?back:'/#compte');return;}
 if(d.confirm){toggle.onclick();message.textContent='Si ton adresse est nouvelle, un e-mail de confirmation vient de partir. Une fois ton adresse confirmée, reviens ici pour te connecter.';}else message.textContent=d.error||'Réessaie dans un instant.';
 }catch{message.textContent='Connexion indisponible. Réessaie dans un instant.';}finally{submit.disabled=toggle.disabled=false;}
};
