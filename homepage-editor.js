'use strict';
(()=>{
const $=s=>document.querySelector(s),all=s=>Array.from(document.querySelectorAll(s)),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let current=null,checking=false,publishing=false,pendingReload=false;
const editorDialog=node('dialog',undefined,'home-edit-dialog');
editorDialog.setAttribute('aria-label','Édition du contenu');document.body.append(editorDialog);
const endpoint='/api/homepage',imageIds=/^(hero-image|(?:access|scope|club|faq|offer-access|compat)-\d+|offer-plan-(?:day|week|month|life))$/;
const fieldNames={eyebrow:'Surtitre',title:'Titre',title1:'Titre · ligne 1',title2:'Titre · ligne 2',text:'Texte',primary:'Bouton principal',secondary:'Bouton secondaire',cta:'Bouton',image:'Image',item1:'Point clé 1',item2:'Point clé 2'};
const isOwner=()=>typeof user!=='undefined'&&user?.homeEditor===true;
const fieldNodes=el=>Array.from(el.querySelectorAll('[data-home-field]')).filter(n=>n.closest('[data-home-block]')===el);
function imageFor(el,value){
 if(el.dataset.homeBlock.startsWith('offer-plan-')){el.style.setProperty('--offer-custom-art',value?'url('+JSON.stringify(value)+')':'none');el.dataset.offerArtwork='custom';return;}
 const bg=el.querySelector('[data-home-background]');if(bg){if(value)bg.style.backgroundImage='url('+JSON.stringify(value)+')';else bg.style.backgroundImage='none';return;}
 let img=el.querySelector(':scope > .home-card-image');if(!value){img?.remove();return;}
 if(!img){img=node('img',undefined,'home-card-image');img.alt='';img.loading='lazy';img.decoding='async';const target=el.querySelector(':scope > h3')||el.firstElementChild;if(el.dataset.homeBlock.startsWith('compat-'))el.append(img);else el.insertBefore(img,target||null);}
 if(img.getAttribute('src')!==value)img.src=value;
}
function apply(){
 for(const el of all('[data-home-block]')){
  const patch=current?.blocks?.[el.dataset.homeBlock];
  if(patch){for(const field of fieldNodes(el)){const v=patch[field.dataset.homeField];if(typeof v==='string'&&field.textContent!==v)field.textContent=v;}if(Object.hasOwn(patch,'image'))imageFor(el,patch.image);}
  let pen=el.querySelector(':scope > .home-edit-pen');
  if(!isOwner()||!current){pen?.remove();el.classList.remove('home-editable');continue;}
  el.classList.add('home-editable');
  if(!pen){pen=node('button',undefined,'home-edit-pen');pen.type='button';pen.setAttribute('aria-label','Modifier : '+el.dataset.homeLabel);pen.title='Modifier : '+el.dataset.homeLabel;pen.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 4 4 4M4 20l4.5-1 12-12a2.8 2.8 0 0 0-4-4l-12 12L4 20Z"/></svg>';pen.onclick=()=>edit(el);el.append(pen);}
 }
}
async function request(url,options={}){const res=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});let data;try{data=await res.json();}catch{data={};}if(!res.ok){const error=Error(data.error||'Requête indisponible ('+res.status+').');error.status=res.status;throw error;}return data;}
function maybeReload(){if(pendingReload&&!editorDialog.open&&!$('#modal')?.open&&!publishing){location.reload();}}
async function check(){if(checking||publishing||document.visibilityState==='hidden')return;checking=true;try{const latest=await request(endpoint);if(publishing)return;if(typeof latest.revision!=='string'||!latest.blocks)return;if(current&&current.revision!==latest.revision){pendingReload=true;maybeReload();return;}current=latest;apply();}catch{}finally{checking=false;}}
function edit(el){
 if(!isOwner()||!current||publishing)return;
 const id=el.dataset.homeBlock,revision=current.revision,prior=current.blocks[id]||{};
 const fields={},inputs={};let file=null,removeImage=false;
 const form=node('form',undefined,'home-edit-form'),heading=node('div',undefined,'home-edit-heading');
 const head=node('div');head.append(node('small',document.querySelector('.offers')?'BRO. / ÉDITION DES OFFRES':'BRO. / ÉDITION DE L’ACCUEIL'),node('h2',el.dataset.homeLabel||'Modifier la box'));const close=node('button','×','home-edit-close');close.type='button';close.setAttribute('aria-label','Fermer');close.onclick=()=>{if(!publishing)editorDialog.close();};heading.append(head,close);form.append(heading);
 const description=node('p',id.startsWith('offer-plan-')?'Personnalise le titre, la description, le bouton et l’arrière-plan. Le prix, la durée et le paiement restent inchangés.':'Les modifications seront visibles par tous les visiteurs après publication.','home-edit-note');form.append(description);
 const preview=node('div',undefined,'home-edit-preview');preview.append(node('small','APERÇU'));const sample=node('div',undefined,'home-edit-sample');preview.append(sample);
 function repaint(){sample.replaceChildren();for(const field of fieldNodes(el)){const k=field.dataset.homeField;sample.append(node(k==='title'||k==='title1'||k==='title2'?'strong':'p',inputs[k]?.value??field.textContent));}}
 for(const field of fieldNodes(el)){const k=field.dataset.homeField;const label=node('label',fieldNames[k]||k);const input=node(k==='text'?'textarea':'input');input.value=field.textContent.trim();input.required=true;input.maxLength=k==='text'?1600:140;if(k==='text')input.rows=4;input.oninput=repaint;inputs[k]=input;label.append(input);form.append(label);}
 if(imageIds.test(id)){
  const label=node('label','Image · PNG, JPEG ou WebP (4 Mo maximum)');const picker=node('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';label.append(picker);
  const imagePreview=node('img',undefined,'home-edit-image-preview');imagePreview.alt='Aperçu de l’image';imagePreview.hidden=true;
  const currentImage=prior.image??(id.startsWith('offer-plan-')?'/assets/robrun-police.webp':id==='hero-image'?(typeof site!=='undefined'?site?.content?.heroImage:''):'');
  if(currentImage){imagePreview.src=currentImage;imagePreview.hidden=false;}
  picker.onchange=()=>{const candidate=picker.files[0];if(!candidate)return;if(candidate.size>4*1024*1024||!['image/png','image/jpeg','image/webp'].includes(candidate.type)){file=null;picker.value='';message.textContent='Image non valide. Formats PNG, JPEG ou WebP, 4 Mo maximum.';return;}file=candidate;removeImage=false;const reader=new FileReader();reader.onload=()=>{imagePreview.src=String(reader.result);imagePreview.hidden=false;};reader.readAsDataURL(candidate);message.textContent='Image sélectionnée. Publie pour appliquer.';};
  const remove=node('button','Retirer l’image','btn ghost');remove.type='button';remove.onclick=()=>{file=null;removeImage=true;picker.value='';imagePreview.hidden=true;imagePreview.removeAttribute('src');};
  form.append(label,imagePreview,remove);
 }
 repaint();if(fieldNodes(el).length)form.append(preview);
 const message=node('p','','home-edit-message');message.setAttribute('role','status');
 const actions=node('div',undefined,'home-edit-actions');const cancel=node('button','Annuler','btn ghost');cancel.type='button';cancel.onclick=()=>{if(!publishing)editorDialog.close();};const submit=node('button','Publier','btn cyan');submit.type='submit';actions.append(cancel,submit);form.append(message,actions);
 form.onsubmit=async e=>{e.preventDefault();if(publishing)return;publishing=true;submit.disabled=true;close.disabled=true;cancel.disabled=true;submit.textContent='Publication…';message.textContent='Enregistrement sécurisé…';try{
  for(const [k,input] of Object.entries(inputs))fields[k]=input.value.trim();
  if(file){const uploaded=await request(endpoint+'/media',{method:'POST',headers:{'Content-Type':file.type},body:file});fields.image=uploaded.url;}else if(removeImage)fields.image='';
  if(!Object.keys(fields).length){message.textContent='Sélectionne une image à publier.';return;}
  const result=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json','If-Match':revision},body:JSON.stringify({id,fields})});current=result;pendingReload=false;apply();editorDialog.close();
  const toast=node('div','Modification publiée.','home-edit-toast');toast.setAttribute('role','status');document.body.append(toast);setTimeout(()=>toast.remove(),3000);
 }catch(error){message.textContent=error.message||'Publication impossible.';}finally{publishing=false;submit.disabled=false;cancel.disabled=false;close.disabled=false;submit.textContent='Publier';}};
 editorDialog.replaceChildren(form);editorDialog.showModal();
}
editorDialog.addEventListener('cancel',e=>{if(publishing)e.preventDefault();});
editorDialog.addEventListener('close',()=>{editorDialog.replaceChildren();maybeReload();});
$('#modal')?.addEventListener('close',maybeReload);
window.addEventListener('bro-home-render',apply);window.addEventListener('bro-session-changed',apply);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){maybeReload();check();}});
window.addEventListener('focus',check);setInterval(check,5000);check();
})();
