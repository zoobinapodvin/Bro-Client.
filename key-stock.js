'use strict';
const $=s=>document.querySelector(s),endpoint='/api/admin/key-stock';
const labels={day:'1 jour',week:'1 semaine',month:'1 mois',life:'Lifetime',legacy:'Historique'},states={available:'Disponible',assigned:'Vendue',expired:'Expirée',legacy:'Historique',sold:'Vendue (import)',quarantine:'À vérifier'};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let data=null,selected='all',page=1,loading=false,submitting=false,revision=0,revealSeq=0;const pageSize=15;
const remaining=r=>r.expiresAt===null?(r.planId==='life'&&r.paymentId?'À vie':'—'):Date.parse(r.expiresAt)<=Date.now()?'Expirée':Math.ceil((Date.parse(r.expiresAt)-Date.now())/3600000)+' h restantes';
const date=v=>v?new Date(v).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';
const notice=(message,type='info')=>{const b=$('#banner');b.hidden=!message;b.textContent=message;b.dataset.type=type;};
const formStatus=(message,type='info')=>{const b=$('#status');b.textContent=message;b.dataset.type=type;};
function busy(button,on,label){if(on){button.dataset.original=button.textContent;button.replaceChildren(el('span','', 'spinner'),document.createTextNode(label));button.disabled=true;button.setAttribute('aria-busy','true');}else{button.textContent=button.dataset.original||button.textContent;button.disabled=false;button.removeAttribute('aria-busy');}}
async function request(url,options={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});let body;try{body=await r.json();}catch{body={};}if(!r.ok){const e=Error(body.error||(r.status===409?'Cette clé est déjà enregistrée.':r.status===404||r.status===401?'Session propriétaire expirée. Reconnecte-toi.':'Requête refusée ('+r.status+').'));e.status=r.status;throw e;}return body;}
const empty=(title,description)=>{const box=el('div',undefined,'empty');box.append(el('span','◇','empty-icon'),el('strong',title),el('p',description));return box;};
function table(rows,cols){const t=el('table'),head=el('thead'),hr=el('tr');for(const c of cols)hr.append(el('th',c[0]));head.append(hr);t.append(head);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const c of cols){const td=el('td'),value=c[1](row);if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td);}body.append(tr);}t.append(body);return t;}
function selectPlan(plan){selected=plan;page=1;if(labels[plan]&&plan!=='legacy'){$('#plan').value=plan;$('#import-plan').value=plan;}$('#heading').textContent=plan==='all'?'Gestion des clés':plan==='legacy'?'Historique des clés':'Pass '+labels[plan];document.querySelectorAll('#nav button').forEach(b=>{if(b.dataset.plan===plan)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});render();}
function render(){if(!data)return;
 $('#summary').replaceChildren(...Object.entries(data.counts).map(([id,n])=>{const card=el('button',undefined,'metric'+(selected===id?' selected':''));card.type='button';card.onclick=()=>selectPlan(id);card.setAttribute('aria-pressed',String(selected===id));const top=el('div',undefined,'metric-top');top.append(el('span',labels[id]),el('span',id==='life'?'∞':'◷','metric-icon'));card.append(top,el('strong',String(n.available)),el('small','Clés disponibles'));const details=el('div',undefined,'metric-bottom');details.append(el('span',n.assigned+' vendues'),el('span',n.waiting+' en attente'));card.append(details);$('#nav-'+id).textContent=n.available;return card;}));
 const matchPlan=r=>selected==='all'||(selected==='legacy'?r.status==='legacy':r.planId===selected);
 const pending=data.pending.filter(matchPlan);$('#pending-count').textContent=pending.length;
 $('#pending').replaceChildren(pending.length?table(pending,[['Pass',r=>labels[r.planId]],['Compte Discord',r=>r.discordId],['Paiement',r=>r.paymentId],['Durée',remaining],['Statut',r=>el('span',r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()?'Expirée sans livraison':data.deliveryPaused?'Livraison suspendue':'En attente','badge waiting')],['Action',r=>{const b=el('button','Attribuer une clé','secondary small');b.type='button';b.disabled=!!data.deliveryPaused||!!(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now());b.onclick=()=>openAssignment(r);return b;}]]):empty('Aucune commande en attente','Les commandes non servies apparaîtront ici.'));
 const q=$('#search').value.trim().toLowerCase();const rows=data.rows.filter(r=>matchPlan(r)&&($('#state').value==='all'||r.status===$('#state').value)&&(!q||[r.id,r.discordId,r.paymentId,labels[r.planId],states[r.status]].some(v=>String(v??'').toLowerCase().includes(q)))).sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
 $('#inventory-title').textContent=selected==='all'?'Toutes les clés':selected==='legacy'?'Clés historiques':'Clés · '+labels[selected];
 $('#row-count').textContent=rows.length+' clé'+(rows.length!==1?'s':'');
 const max=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,max);
 const show=r=>{const b=el('button','Voir la clé','secondary small');b.type='button';b.onclick=()=>reveal(r,b);return b;};
 $('#inventory').replaceChildren(rows.length?table(rows.slice((page-1)*pageSize,page*pageSize),[['Licence',r=>{const c=el('div',undefined,'license-cell');c.append(el('strong','•••• •••• ••••'),el('small','#'+r.id.slice(0,10)));return c;}],['Pass',r=>labels[r.planId]||'Historique'],['Statut',r=>el('span',states[r.status],'badge '+r.status)],['Compte / paiement',r=>{const c=el('div',undefined,'license-cell');c.append(el('strong',r.discordId||'—'),el('small',r.paymentId||'Non attribuée'));return c;}],['Date d’ajout',r=>date(r.createdAt)],['Durée',r=>r.status==='available'?'Non attribuée':r.status==='sold'||r.status==='quarantine'?'Verrouillée':remaining(r)],['Action',show]]):empty('Aucune clé dans cette vue','Ajoute une clé ou modifie les filtres pour consulter ton stock.'));
 const pagination=$('#pagination');pagination.replaceChildren();if(rows.length>pageSize){const prev=el('button','Précédent','secondary small'),next=el('button','Suivant','secondary small');prev.disabled=page===1;next.disabled=page===max;prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};pagination.append(prev,el('span','Page '+page+' / '+max),next);}
}

const assignDialog=el('dialog'),assignForm=el('form'),assignHeading=el('h2','Attribuer une clé'),assignDetail=el('p'),assignLabel=el('label','Clé du stock'),assignSelect=el('select'),newLabel=el('label','Nouvelle clé de licence'),newInput=el('input'),assignStatus=el('div',undefined,'form-status'),assignActions=el('div',undefined,'dialog-actions'),assignCancel=el('button','Annuler','secondary'),assignSubmit=el('button','Confirmer l’attribution','primary');
let assignmentOrder=null;
newInput.type='password';newInput.autocomplete='off';newInput.spellcheck=false;newInput.minLength=5;newInput.maxLength=256;newInput.placeholder='Saisir la nouvelle clé';
assignLabel.append(assignSelect);newLabel.append(newInput);assignCancel.type='button';assignSubmit.type='submit';assignStatus.setAttribute('role','status');
assignActions.append(assignCancel,assignSubmit);assignForm.append(assignHeading,assignDetail,assignLabel,newLabel,assignStatus,assignActions);assignDialog.append(assignForm);document.body.append(assignDialog);
function syncAssignment(){const isNew=assignSelect.value==='new';newLabel.hidden=!isNew;newInput.disabled=!isNew;newInput.required=isNew;if(!isNew)newInput.value='';}
assignSelect.onchange=syncAssignment;
function openAssignment(order){
 if(submitting||loading||data.deliveryPaused)return;
 assignmentOrder=order;assignDetail.textContent=labels[order.planId]+' · Discord '+order.discordId+' · '+order.paymentId;
 const stock=data.rows.filter(r=>r.planId===order.planId&&r.status==='available');
 assignSelect.replaceChildren(...stock.map(r=>{const o=el('option','Clé #'+r.id.slice(0,10));o.value=r.id;return o;}));
 const opt=el('option','Ajouter une nouvelle clé et l’attribuer');opt.value='new';assignSelect.append(opt);
 newInput.value='';assignStatus.textContent='';syncAssignment();assignDialog.showModal();
}
assignCancel.onclick=()=>{if(!submitting)assignDialog.close();};
assignDialog.addEventListener('cancel',e=>{if(submitting)e.preventDefault();});
assignDialog.addEventListener('close',()=>{newInput.value='';assignmentOrder=null;assignStatus.textContent='';});
assignForm.onsubmit=async e=>{
 e.preventDefault();if(submitting||!assignmentOrder)return;
 const order=assignmentOrder,choice=assignSelect.value,body={discordId:order.discordId,paymentId:order.paymentId,...(choice==='new'?{key:newInput.value.trim()}:{keyId:choice})};
 submitting=true;++revision;busy(assignSubmit,true,'Attribution…');assignCancel.disabled=true;assignSelect.disabled=true;newInput.disabled=true;
 assignStatus.textContent='Vérification du paiement et du stock…';assignStatus.dataset.type='info';
 let refresh=false;
 try{const result=await request(endpoint+'/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assignDialog.close();if(result.overview){data=result.overview;render();}else refresh=true;notice(result.status==='already_assigned'?'Cette commande avait déjà reçu une clé.':'Clé vendue et attribuée à la commande. Disponible dans l’espace client.','success');}
 catch(err){assignStatus.textContent=err.name==='TimeoutError'?'Réponse incertaine. Annule et actualise le stock avant de réessayer.':err.message;assignStatus.dataset.type='error';}
 finally{submitting=false;busy(assignSubmit,false);assignCancel.disabled=false;assignSelect.disabled=false;syncAssignment();if(refresh)load();}
};

async function load({manual=false}={}){if(loading||submitting)return;loading=true;const rev=++revision;busy($('#refresh'),true,'Actualisation…');try{const result=await request(endpoint);if(rev===revision){data=result;render();notice(manual?'Stock actualisé.':'', 'success');}}catch(e){notice(e.name==='TimeoutError'?'Le serveur met trop de temps à répondre. Réessaie.':e.message,'error');if(!data){$('#inventory').replaceChildren(empty('Stock indisponible','Utilise le bouton Actualiser pour réessayer.'));$('#pending').replaceChildren(empty('Commandes indisponibles','Le chargement a échoué.'));}}finally{loading=false;busy($('#refresh'),false);}}
$('#stock-form').onsubmit=async e=>{e.preventDefault();if(submitting)return;const plan=$('#plan').value,key=$('#key').value.trim();if(key.length<5){formStatus('Saisis une clé valide.','error');return;}submitting=true;++revision;busy($('#add'),true,'Enregistrement…');$('#plan').disabled=true;$('#key').disabled=true;formStatus('Vérification et chiffrement de la clé…');try{const result=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:plan,key})});$('#key').value='';$('#key').type='password';$('#toggle-key').textContent='Afficher';formStatus(result.assigned?'Clé ajoutée et attribuée à une commande en attente.':'Clé ajoutée avec succès.','success');if(result.overview){data=result.overview;selectPlan(plan);}else{selected=plan;notice('Clé enregistrée. Actualise le stock pour afficher la dernière version.','info');}}catch(e){formStatus(e.name==='TimeoutError'?'Réponse trop lente. Actualise le stock avant de réessayer.':e.message,'error');}finally{submitting=false;busy($('#add'),false);$('#plan').disabled=false;$('#key').disabled=false;$('#key').focus();if(!data)load();}};
async function reveal(row,button){const seq=++revealSeq;busy(button,true,'Chargement…');try{const result=await request(endpoint+'/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id})});if(seq!==revealSeq)return;$('#key-detail').textContent=(labels[row.planId]||'Historique')+' · '+states[row.status];$('#revealed').value=result.key;$('#copy-status').textContent='';$('#key-dialog').showModal();}catch(e){notice(e.message,'error');}finally{busy(button,false);}}
$('#close-dialog').onclick=()=>$('#key-dialog').close();$('#key-dialog').addEventListener('close',()=>{++revealSeq;$('#revealed').value='';$('#copy-status').textContent='';});
$('#copy-key').onclick=async()=>{try{await navigator.clipboard.writeText($('#revealed').value);$('#copy-status').textContent='Clé copiée.';}catch{$('#revealed').select();$('#copy-status').textContent='Copie manuelle disponible.';}};
$('#toggle-key').onclick=()=>{const input=$('#key');input.type=input.type==='password'?'text':'password';$('#toggle-key').textContent=input.type==='password'?'Afficher':'Masquer';};
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>selectPlan(b.dataset.plan));
$('#search').oninput=()=>{page=1;render();};$('#state').onchange=()=>{page=1;render();};$('#refresh').onclick=()=>load({manual:true});
const linkedPayment=new URLSearchParams(location.search).get('payment');if(/^pay_[A-Za-z0-9]+$/.test(linkedPayment||''))$('#search').value=linkedPayment;load();
$('#import-form').onsubmit=async e=>{
 e.preventDefault();if(submitting)return;
 const field=$('#import-rows'),plan=$('#import-plan').value,status=$('#import-status');
 const rows=field.value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const [key,raw='']=line.split('\t');const type=raw.trim().toLowerCase();return {key:key.trim(),status:type==='libre'?'available':type==='vendu'||type==='vendue'?'sold':'quarantine'};});
 if(!rows.length||rows.length>500){status.textContent='Importe entre 1 et 500 lignes.';return;}
 submitting=true;++revision;busy($('#import-submit'),true,'Import sécurisé…');field.disabled=true;status.textContent='Vérification des doublons et chiffrement…';status.dataset.type='info';
 try{const result=await request(endpoint+'/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:plan,rows})});field.value='';status.textContent=result.added+' ajoutées · '+result.existing+' déjà présentes · '+result.locked+' vendues verrouillées · '+result.quarantined+' à vérifier · '+result.duplicates+' doublons fusionnés · '+result.conflicts+' conflits de catégorie.';status.dataset.type='success';if(result.overview){data=result.overview;selectPlan(plan);}else notice('Import enregistré. Actualise le stock.');}catch(err){status.textContent=err.name==='TimeoutError'?'Réponse trop lente. Actualise le stock avant de réessayer.':err.message;status.dataset.type='error';}finally{submitting=false;field.disabled=false;busy($('#import-submit'),false);if(!data)load();}
};
let workbookPreview=null,workbookRequest=0;
$('#xlsx-file').onchange=async()=>{
 const rev=++workbookRequest;workbookPreview=null;$('#xlsx-confirm').disabled=true;$('#xlsx-result').textContent='';
 const file=$('#xlsx-file').files[0],preview=$('#xlsx-preview');preview.textContent=file?'Lecture locale du fichier…':'';preview.dataset.type='info';if(!file)return;
 try{const result=await window.readStockWorkbook(file);if(rev!==workbookRequest)return;workbookPreview=result;
  const lines=[];for(const plan of ['day','week','month','life']){const group=result.rows.filter(r=>r.planId===plan);if(group.length)lines.push(labels[plan]+': '+group.filter(r=>r.status==='available').length+' libres · '+group.filter(r=>r.status==='sold').length+' vendues · '+group.filter(r=>r.status==='quarantine').length+' à vérifier');}
  preview.replaceChildren(...lines.map(s=>el('div',s)),el('div',result.rows.length+' clés uniques · '+result.duplicates+' doublons fusionnés · '+result.ignored+' lignes sans clé ignorées'+(result.unknown.length?' · '+result.unknown.length+' feuilles non reconnues ignorées':'')));preview.dataset.type='success';$('#xlsx-confirm').disabled=false;
 }catch(err){if(rev===workbookRequest){preview.textContent=err.message||'Impossible de lire ce fichier Excel.';preview.dataset.type='error';}}
};
$('#xlsx-confirm').onclick=async()=>{
 if(submitting||!workbookPreview)return;submitting=true;++revision;const button=$('#xlsx-confirm'),field=$('#xlsx-file'),status=$('#xlsx-result');busy(button,true,'Import sécurisé…');field.disabled=true;status.textContent='Chiffrement et import atomique des feuilles…';status.dataset.type='info';
 try{const result=await request(endpoint+'/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:null,rows:workbookPreview.rows})});workbookPreview=null;field.value='';$('#xlsx-preview').textContent='';status.textContent=result.added+' ajoutées · '+result.existing+' déjà présentes · '+result.locked+' vendues verrouillées · '+result.quarantined+' à vérifier.';status.dataset.type='success';if(result.overview){data=result.overview;selectPlan('all');}else notice('Import enregistré. Actualise le stock.');}
 catch(err){status.textContent=err.name==='TimeoutError'?'Réponse trop lente. Actualise le stock puis relance si nécessaire.':err.message;status.dataset.type='error';}
 finally{submitting=false;field.disabled=false;busy(button,false);button.disabled=!workbookPreview;if(!data)load();}
};
