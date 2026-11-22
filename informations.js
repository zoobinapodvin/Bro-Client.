(async()=>{
 const response=await fetch('/api/site');if(!response.ok)return;
 const {content}=await response.json();
 for(const [key,label] of Object.entries({legalIdentity:'Éditeur',legalAddress:'Adresse professionnelle',legalRegistration:'Immatriculation et TVA',legalDirector:'Direction de publication',legalContact:'Contact public',legalPhone:'Téléphone'})){
  if(!content[key])continue;
  const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=content[key];document.querySelector('#identity').append(dt,dd);
 }
 document.querySelector('#mediator').textContent=content.legalMediator||'';
})().catch(()=>{});
