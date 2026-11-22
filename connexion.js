const message=document.querySelector('[role=status]');
const params=new URLSearchParams(location.search);
const code=params.get('code');
const next=params.get('return_to');
const destinationField=document.querySelector('input[name="return_to"]');
if(next&&(next==='/offres'||/^\/checkout\/(day|week|month|life)$/.test(next)))destinationField.value=next;
if(params.has('error')||location.hash.includes('error=')){
  message.textContent='La connexion Discord a été interrompue. Tu peux réessayer.';
}
if(params.get('status')==='unavailable'){
  message.textContent='La connexion Discord est en cours d’activation. Les pass restent disponibles depuis la boutique.';
}
history.replaceState(null,'',location.pathname);
if(code){
  const submit=document.querySelector('button[type=submit]');
  submit.disabled=true;
  message.textContent='Connexion à ton espace Bro Client…';
  (async()=>{
    try{
      const res=await fetch('/auth/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
      const result=await res.json();
      if(!res.ok)throw Error(result.error||'Connexion indisponible.');
      location.replace(result.redirect||'/#compte');
    }catch(error){message.textContent=error.message;submit.disabled=false;}
  })();
}
