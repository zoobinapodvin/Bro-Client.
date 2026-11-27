'use strict';
const $=s=>document.querySelector(s),endpoint='/api/admin/key-stock';
const labels={day:'1 jour',week:'1 semaine',month:'1 mois',life:'Lifetime',legacy:'Historique'},states={available:'Disponible',assigned:'Vendue',expired:'Vendue · accès terminé',legacy:'Historique',sold:'Vendue (import)',quarantine:'À vérifier'};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
let data=null,selected='all',page=1,loading=false,submitting=false,revision=0,revealSeq=0;const pageSize=10;
const remaining=r=>r.expiresAt===null?(r.planId==='life'&&r.paymentId?'À vie':'—'):Date.parse(r.expiresAt)<=Date.now()?'Terminé':Math.ceil((Date.parse(r.expiresAt)-Date.now())/3600000)+' h restantes';
const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';
// The current catalogue contains only Rob Run. Future server-provided game labels are displayed as text.
const gameName=row=>typeof row.gameName==='string'&&row.gameName.trim()?row.gameName.trim():row.planId&&['day','week','month','life'].includes(row.planId)?'Rob Run':'Non renseigné';
function latestSales(rows){return rows.filter(r=>['assigned','expired'].includes(r.status)&&r.paymentId&&r.discordId&&Number.isFinite(Date.parse(r.assignedAt||''))).sort((a,b)=>Date.parse(b.assignedAt)-Date.parse(a.assignedAt)||a.id.localeCompare(b.id)).slice(0,10);}
function saleDate(row){return row.assignedAt||null;}
const notice=(message,type='info')=>{const b=$('#banner');b.hidden=!message;b.textContent=message;b.dataset.type=type;};
const formStatus=(message,type='info')=>{const b=$('#status');b.textContent=message;b.dataset.type=type;};
function busy(button,on,label){if(on){button.dataset.original=button.textContent;button.replaceChildren(el('span','', 'spinner'),document.createTextNode(label));button.disabled=true;button.setAttribute('aria-busy','true');}else{button.textContent=button.dataset.original||button.textContent;button.disabled=false;button.removeAttribute('aria-busy');}}
async function request(url,options={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(20000),...options});let body;try{body=await r.json();}catch{body={};}if(!r.ok){if(r.status===401||r.status===404&&url===endpoint&&(!options.method||options.method==='GET')){data=null;++revealSeq;$('#revealed').value='';if($('#key-dialog').open)$('#key-dialog').close();for(const id of ['inventory','pending','summary','overview-totals','quick-filters'])$('#'+id).replaceChildren();for(const node of document.querySelectorAll('#nav b'))node.textContent='—';}const e=Error(body.error||(r.status===409?'Cette clé est déjà enregistrée.':r.status===404||r.status===401?'Session propriétaire expirée. Reconnecte-toi.':'Requête refusée ('+r.status+').'));e.status=r.status;throw e;}return body;}
const empty=(title,description)=>{const box=el('div',undefined,'empty');box.append(el('span','◇','empty-icon'),el('strong',title),el('p',description));return box;};
function table(rows,cols,kind='stock'){const t=el('table',undefined,'stock-table '+kind);t.setAttribute('role','table');const head=el('thead'),hr=el('tr');for(const c of cols){const th=el('th',c[0]);th.scope='col';hr.append(th);}head.append(hr);t.append(head);const body=el('tbody');for(const row of rows){const tr=el('tr');tr.setAttribute('role','row');for(const c of cols){const td=el('td'),value=c[1](row);td.dataset.label=c[0];td.dataset.cell=c[2]||'';td.setAttribute('role','cell');if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td);}body.append(tr);}t.append(body);return t;}
const views={
 all:['Vue globale','Suivi de ton inventaire et des commandes.'],
 inventory:['Toutes les clés','Inventaire complet, toutes catégories confondues.'],
 day:['Pass 1 jour','Stock et ventes de ce pass.'],
 week:['Pass 1 semaine','Stock et ventes de ce pass.'],
 month:['Pass 1 mois','Stock et ventes de ce pass.'],
 life:['Pass Lifetime','Stock et ventes de ce pass.'],
 supply:['Approvisionnement','Ajouter des clés ou importer un fichier Excel.'],
 pending:['Commandes en attente','Paiements confirmés en attente de livraison.'],
 legacy:['Historique','Clés vendues, accès terminés et anciennes licences.']
};
function viewState(view){
 const category=['day','week','month','life'].includes(view);
 return {category,summary:view==='all'||category,supply:view==='supply',pending:view==='all'||view==='pending',inventory:view==='all'||view==='inventory'||category||view==='legacy',preview:view==='all'};
}
function selectPlan(plan,{keepFilters=false}={}){
 if(!Object.hasOwn(views,plan))return;
 ++revealSeq;if($('#key-dialog').open)$('#key-dialog').close();
 selected=plan;page=1;
 if(!keepFilters){$('#search').value='';$('#state').value='all';}
 if(viewState(plan).category&&!submitting){$('#plan').value=plan;$('#import-plan').value=plan;}
 $('#mobile-view').value=plan;$('#heading').textContent=views[plan][0];$('#breadcrumb').textContent=views[plan][0];$('#subtitle').textContent=views[plan][1];
 document.querySelectorAll('#nav button').forEach(b=>{if(b.dataset.plan===plan)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 render();window.scrollTo({top:0,behavior:'instant'});
}
function render(){
 const v=viewState(selected);
 document.body.dataset.view=selected;$('#overview-totals').hidden=!v.preview;$('#summary-heading').hidden=!v.preview;$('#quick-filters').hidden=!v.category;$('#summary').hidden=!v.summary;$('#supply-view').hidden=!v.supply;$('#pending-view').hidden=!v.pending;$('#inventory-view').hidden=!v.inventory;$('#inventory-filters').hidden=v.preview;$('#view-all').hidden=!v.preview;
 if(!data)return;
 for(const [id,n] of Object.entries(data.counts))$('#nav-'+id).textContent=n.available;
 $('#nav-pending').textContent=data.pending.length;
 if(v.summary){
  const groups=v.category?[[selected,data.counts[selected]]]:Object.entries(data.counts);
  const createStat=(number,title,tone,action)=>{
    const item=el(action?'button':'div',undefined,'stat-tile '+tone);
    if(action){item.type='button';item.onclick=action;}
    item.append(el('span',title,'stat-label'),el('strong',String(number)));
    return item;
  };
  $('#summary').classList.toggle('single',v.category);
  if(v.preview){
    const totals=Object.values(data.counts).reduce((a,n)=>({available:a.available+n.available,assigned:a.assigned+n.assigned,waiting:a.waiting+n.waiting}),{available:0,assigned:0,waiting:0});
    $('#overview-totals').replaceChildren(createStat(totals.available,'Clés en stock','ready',()=>{selectPlan('inventory');$('#state').value='available';render();}),createStat(totals.assigned,'Clés vendues','sold',()=>selectPlan('legacy')),createStat(totals.waiting,'Commandes en attente','waiting',()=>selectPlan('pending')));
    $('#summary').replaceChildren(...groups.map(([id,n])=>{
      const card=el('button',undefined,'metric pass-overview');card.type='button';card.onclick=()=>selectPlan(id);card.setAttribute('aria-label','Consulter le pass '+labels[id]);
      const top=el('div',undefined,'metric-top');top.append(el('span',labels[id]),el('span','›','metric-icon'));
      const value=el('div',undefined,'stock-primary');value.append(el('strong',String(n.available)),el('span','disponibles'));
      const foot=el('div',undefined,'stock-secondary');foot.append(el('span',n.assigned+' vendues'),el('span',n.waiting+' en attente'));
      card.append(top,value,foot);return card;
    }));
  }else{
    const n=data.counts[selected];
    const applyFilter=value=>{ $('#state').value=value;page=1;render();};
    $('#summary').replaceChildren(createStat(n.available,'Disponibles','ready',()=>applyFilter('available')),createStat(n.assigned,'Vendues','sold',()=>applyFilter('sold-all')),createStat(n.waiting,'En attente','waiting',null));
  }
 }
 if(v.pending){
  const pending=data.pending;$('#pending-count').textContent=pending.length;
  const rows=v.preview?pending.slice(0,5):pending;
  $('#pending').replaceChildren(rows.length?table(rows,[['Jeu',gameName,'game'],['Pass',r=>labels[r.planId],'pass'],['Compte Discord',r=>r.discordId,'account'],['Paiement',r=>r.paymentId,'payment'],['Accès Discord',remaining,'date'],['Livraison',r=>el('span',r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()?'Accès terminé':data.deliveryPaused?'Suspendue':'En attente','badge waiting'),'status']],'pending-table'):el('p','Aucune commande en attente.','compact-empty'));
  if(v.preview&&pending.length>5){const more=el('button','Voir les '+pending.length+' commandes →','secondary small');more.onclick=()=>selectPlan('pending');$('#pending').append(more);}
 }
 if(!v.inventory)return;
 const matchPlan=r=>v.category?r.planId===selected:selected==='legacy'?['assigned','expired','sold','legacy'].includes(r.status):true;
 const q=v.preview?'':$('#search').value.trim().toLowerCase(),filter=v.preview?'all':$('#state').value;
 const rows=v.preview?latestSales(data.rows):data.rows.filter(r=>matchPlan(r)&&(filter==='all'||(filter==='sold-all'?['assigned','expired','sold'].includes(r.status):r.status===filter))&&(!q||[r.id,r.discordId,r.paymentId,gameName(r),labels[r.planId],states[r.status]].some(value=>String(value??'').toLowerCase().includes(q)))).sort((a,b)=>String(selected==='legacy'?(b.assignedAt||''):(b.createdAt||'')).localeCompare(String(selected==='legacy'?(a.assignedAt||''):(a.createdAt||''))));
 if(v.category){const group=data.rows.filter(r=>r.planId===selected),quick=$('#quick-filters');quick.replaceChildren(...[['all','Toutes',group.length],['available','Disponibles',group.filter(r=>r.status==='available').length],['sold-all','Vendues',group.filter(r=>['assigned','expired','sold'].includes(r.status)).length],['quarantine','À vérifier',group.filter(r=>r.status==='quarantine').length]].map(([value,label,count])=>{const b=el('button',label+' · '+count,'quick-filter');b.type='button';b.setAttribute('aria-pressed',String(filter===value));b.onclick=()=>{$('#state').value=value;page=1;render();};return b;}));}
 $('#inventory-title').textContent=v.preview?'Dernières clés vendues':selected==='legacy'?'Historique des clés':v.category?'Inventaire · '+labels[selected]:'Inventaire complet';
 $('#row-count').textContent=v.preview?rows.length+' / 10':rows.length+' clé'+(rows.length!==1?'s':'');
 const max=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,max);
 const show=r=>{const b=el('button','Voir','secondary small');b.type='button';b.setAttribute('aria-label','Voir la clé '+r.id.slice(0,10));b.onclick=()=>reveal(r,b);return b;};
 const visible=v.preview?rows:rows.slice((page-1)*pageSize,page*pageSize);
 const columns=[
  ['Jeu',r=>{const c=el('div',undefined,'game-cell');const label=gameName(r);if(label==='Rob Run'){const img=el('img');img.src='/assets/robrunkey.webp';img.alt='';img.width=26;img.height=26;c.append(img);}c.append(el('strong',label));return c;},'game'],
  ...(!v.category?[['Pass',r=>labels[r.planId]||'Historique','pass']]:[]),
  ['Licence',r=>{const c=el('div',undefined,'license-cell');c.append(el('strong','•••• •••• ••••'),el('small','#'+r.id.slice(0,10)));return c;},'license'],
  ['Statut',r=>el('span',v.preview?'Vendue':states[r.status]||'À vérifier','badge '+(v.preview?'assigned':r.status)),'status'],
  ['Compte / paiement',r=>{const c=el('div',undefined,'license-cell account-reference');c.append(el('strong',r.discordId||'—'));const ref=el('small',r.paymentId||'Non attribuée');ref.title=r.paymentId||'';c.append(ref);return c;},'account'],
  [v.preview||selected==='legacy'?'Date d’attribution':'Date d’ajout',r=>date(v.preview||selected==='legacy'?saleDate(r):r.createdAt),'date'],
  ['Action',show,'action']
 ];
 $('#inventory').replaceChildren(visible.length?table(visible,columns,'inventory-table'):el('p',v.preview?'Aucune vente avec une date d’attribution vérifiée.':q||filter!=='all'?'Aucun résultat pour ces filtres.':'Aucune clé dans cette vue.','compact-empty'));
 const pagination=$('#pagination');pagination.replaceChildren();
 if(!v.preview&&rows.length>pageSize){const prev=el('button','‹','secondary small'),next=el('button','›','secondary small');prev.setAttribute('aria-label','Page précédente');next.setAttribute('aria-label','Page suivante');prev.disabled=page===1;next.disabled=page===max;prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};pagination.append(prev,el('span',page+' / '+max),next);}
}
async function load({manual=false}={}){if(loading||submitting)return;loading=true;const rev=++revision;busy($('#refresh'),true,'Actualisation…');try{const result=await request(endpoint);if(rev===revision){data=result;render();notice(manual?'Stock actualisé.':'', 'success');}}catch(e){notice(e.name==='TimeoutError'?'Le serveur met trop de temps à répondre. Réessaie.':e.message,'error');if(!data){$('#inventory').replaceChildren(el('p','Stock indisponible. Actualise pour réessayer.','compact-empty'));$('#pending').replaceChildren(el('p','Commandes indisponibles.','compact-empty'));}}finally{loading=false;busy($('#refresh'),false);}}
$('#stock-form').onsubmit=async e=>{e.preventDefault();if(submitting)return;const plan=$('#plan').value,key=$('#key').value.trim();if(key.length<5){formStatus('Saisis une clé valide.','error');return;}submitting=true;++revision;busy($('#add'),true,'Enregistrement…');$('#plan').disabled=true;$('#key').disabled=true;formStatus('Vérification et chiffrement de la clé…');try{const result=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:plan,key})});$('#key').value='';$('#key').type='password';$('#toggle-key').textContent='Afficher';formStatus(result.assigned?'Clé ajoutée et attribuée à une commande en attente.':'Clé ajoutée avec succès.','success');if(result.overview){data=result.overview;render();}else{notice('Clé enregistrée. Actualise le stock pour afficher la dernière version.','info');}}catch(e){formStatus(e.name==='TimeoutError'?'Réponse trop lente. Actualise le stock avant de réessayer.':e.message,'error');}finally{submitting=false;busy($('#add'),false);$('#plan').disabled=false;$('#key').disabled=false;$('#key').focus();if(!data)load();}};
async function reveal(row,button){const seq=++revealSeq;busy(button,true,'Chargement…');try{const result=await request(endpoint+'/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id})});if(seq!==revealSeq||!button.isConnected)return;$('#key-detail').textContent=(labels[row.planId]||'Historique')+' · '+states[row.status];$('#revealed').value=result.key;$('#copy-status').textContent='';$('#key-dialog').showModal();}catch(e){notice(e.message,'error');}finally{busy(button,false);}}
$('#close-dialog').onclick=()=>$('#key-dialog').close();$('#key-dialog').addEventListener('close',()=>{++revealSeq;$('#revealed').value='';$('#copy-status').textContent='';});
$('#copy-key').onclick=async()=>{try{await navigator.clipboard.writeText($('#revealed').value);$('#copy-status').textContent='Clé copiée.';}catch{$('#revealed').select();$('#copy-status').textContent='Copie manuelle disponible.';}};
$('#toggle-key').onclick=()=>{const input=$('#key');input.type=input.type==='password'?'text':'password';$('#toggle-key').textContent=input.type==='password'?'Afficher':'Masquer';};
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>selectPlan(b.dataset.plan));
$('#search').oninput=()=>{page=1;render();};$('#state').onchange=()=>{page=1;render();};$('#refresh').onclick=()=>load({manual:true});
$('#view-all').onclick=()=>selectPlan('legacy');
$('#mobile-view').onchange=e=>selectPlan(e.target.value);
const linkedPayment=new URLSearchParams(location.search).get('payment');if(/^pay_[A-Za-z0-9]+$/.test(linkedPayment||'')){$('#search').value=linkedPayment;selectPlan('inventory',{keepFilters:true});}else selectPlan('all');load();
$('#import-form').onsubmit=async e=>{
 e.preventDefault();if(submitting)return;
 const field=$('#import-rows'),plan=$('#import-plan').value,status=$('#import-status');
 const rows=field.value.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const [key,raw='']=line.split('\t');const type=raw.trim().toLowerCase();return {key:key.trim(),status:type==='libre'?'available':type==='vendu'||type==='vendue'?'sold':'quarantine'};});
 if(!rows.length||rows.length>500){status.textContent='Importe entre 1 et 500 lignes.';return;}
 submitting=true;++revision;busy($('#import-submit'),true,'Import sécurisé…');field.disabled=true;status.textContent='Vérification des doublons et chiffrement…';status.dataset.type='info';
 try{const result=await request(endpoint+'/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:plan,rows})});field.value='';status.textContent=result.added+' ajoutées · '+result.existing+' déjà présentes · '+result.locked+' vendues verrouillées · '+result.quarantined+' à vérifier · '+result.duplicates+' doublons fusionnés · '+result.conflicts+' conflits de catégorie.';status.dataset.type='success';if(result.overview){data=result.overview;render();}else notice('Import enregistré. Actualise le stock.');}catch(err){status.textContent=err.name==='TimeoutError'?'Réponse trop lente. Actualise le stock avant de réessayer.':err.message;status.dataset.type='error';}finally{submitting=false;field.disabled=false;busy($('#import-submit'),false);if(!data)load();}
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
 try{const result=await request(endpoint+'/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:null,rows:workbookPreview.rows})});workbookPreview=null;field.value='';$('#xlsx-preview').textContent='';status.textContent=result.added+' ajoutées · '+result.existing+' déjà présentes · '+result.locked+' vendues verrouillées · '+result.quarantined+' à vérifier.';status.dataset.type='success';if(result.overview){data=result.overview;render();}else notice('Import enregistré. Actualise le stock.');}
 catch(err){status.textContent=err.name==='TimeoutError'?'Réponse trop lente. Actualise le stock puis relance si nécessaire.':err.message;status.dataset.type='error';}
 finally{submitting=false;field.disabled=false;busy(button,false);button.disabled=!workbookPreview;if(!data)load();}
};

window.addEventListener('pagehide',()=>{++revision;++revealSeq;data=null;workbookPreview=null;++workbookRequest;$('#revealed').value='';$('#key').value='';$('#import-rows').value='';$('#xlsx-file').value='';if($('#key-dialog').open)$('#key-dialog').close();for(const id of ['inventory','pending','summary','overview-totals','quick-filters'])$('#'+id).replaceChildren();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
