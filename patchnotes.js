'use strict';
const $=s=>document.querySelector(s);
const create=(tag,content,cls)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=content;if(cls)el.className=cls;return el;};
const alertBox=$('#patchnotesAlert');
const list=$('#patchnotesList');
const admin=$('#patchnotesAdmin');
let isEditor=false,editing=null,editingUpdatedAt=null,all=[],busy=false;
const safeId=id=>/^[a-z0-9][a-z0-9-]{1,110}$/.test(id??'');
const formatDate=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(value)):'';
function showMessage(text,kind='info'){
 alertBox.hidden=false;alertBox.textContent=text;alertBox.dataset.kind=kind;
 if(kind==='error')alertBox.scrollIntoView({block:'nearest',behavior:'smooth'});
}
async function api(path,options){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||'Service momentanément indisponible.');
 return data;
}
function renderBody(target,value){
 target.replaceChildren();
 const groups=String(value||'').split(/\n\s*\n/).filter(Boolean);
 for(const group of groups){
  const p=create('p',group.trim(),'patchnotes-paragraph');
  p.style.whiteSpace='pre-line';
  target.append(p);
 }
}
function fillEditor(note){
 editing=note?.id??null;editingUpdatedAt=note?.updatedAt??null;
 $('#patchnoteVersion').value=note?.version||'';
 $('#patchnoteTitle').value=note?.title||'';
 $('#patchnoteSummary').value=note?.summary||'';
 $('#patchnoteBody').value=note?.content||'';
 $('#patchnotePublish').checked=note?.status==='published'||!note;
 $('#patchnoteDelete').hidden=!editing;
 $('#patchnotesAdminTitle').textContent=editing?'Modifier la mise à jour':'Publier une mise à jour';
}
function loadList(notes){
 list.replaceChildren();
 if(!notes.length){list.append(create('p','Aucune mise à jour publiée pour le moment.','patchnotes-empty'));return;}
 for(const note of notes){
  const link=create('a',undefined,'patchnotes-entry');
  link.href='/patchnotes/'+encodeURIComponent(note.id);
  const top=create('div',undefined,'patchnotes-entry-top');
  top.append(create('span','VERSION '+note.version,'patchnotes-version'),create('time',formatDate(note.publishedAt??note.updatedAt),'patchnotes-date'));
  link.append(top,create('h2',note.title),create('p',note.summary),
    create('span','Consulter la mise à jour','patchnotes-see'));
  if(note.status==='draft')link.append(create('span','Brouillon','patchnotes-draft-label'));
  list.append(link);
 }
}
function loadDetail(note){
 $('#patchnotesIndex').hidden=true;$('#patchnotesDetail').hidden=false;
 $('#patchnotesTitle').textContent=note.title;
 $('#patchnotesSubtitle').textContent='Version '+note.version+' · '+formatDate(note.publishedAt??note.updatedAt);
 const wrap=$('#patchnoteContent');wrap.replaceChildren();
 wrap.append(create('span','BRO CLIENT / VERSION '+note.version,'capability-eyebrow'),
   create('p',note.summary,'patchnotes-detail-summary'));
 const article=create('div',undefined,'patchnotes-body');renderBody(article,note.content);wrap.append(article);
 document.title=note.title+' · Patchnotes · BRO CLIENT';
 if(isEditor){fillEditor(note);admin.hidden=false;}
}
async function refresh(){
 const slug=location.pathname.split('/').filter(Boolean).slice(1).join('/');
 const data=await api('/api/patchnotes');
 isEditor=data.editor===true;all=data.notes||[];
 if(isEditor){admin.hidden=false;fillEditor(null);}
 if(slug){
  if(!safeId(slug))throw Error('Mise à jour introuvable.');
  const result=await api('/api/patchnotes/'+encodeURIComponent(slug));
  loadDetail(result.note);
 }else loadList(all);
}
function setBusy(value){busy=value;$('#patchnoteSave').disabled=value;$('#patchnoteDelete').disabled=value;$('#patchnotesNew').disabled=value;}
$('#patchnotesNew').addEventListener('click',()=>{if(!busy)fillEditor(null);});
$('#patchnotesForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!isEditor||busy)return;
 setBusy(true);
 try{
  const payload={action:editing?'update':'create',id:editing,...(editing&&editingUpdatedAt?{expectedUpdatedAt:editingUpdatedAt}:{}),version:$('#patchnoteVersion').value,
   title:$('#patchnoteTitle').value,summary:$('#patchnoteSummary').value,content:$('#patchnoteBody').value,
   publish:$('#patchnotePublish').checked};
  const result=await api('/api/patchnotes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!result.item||!safeId(result.item.id)||(editing&&result.item.id!==editing))throw Error('La sauvegarde n’a pas été confirmée.');
  const url='/patchnotes/'+encodeURIComponent(result.item.id);
  history.replaceState(null,'',url);
  loadDetail(result.item);
  showMessage(result.item.status==='published'?'Mise à jour enregistrée et publiée.':'Brouillon enregistré.','success');
 }catch(error){showMessage(error.message,'error');}
 finally{setBusy(false);}
});
$('#patchnoteDelete').addEventListener('click',async()=>{
 if(!isEditor||!editing||busy||!confirm('Supprimer définitivement cette mise à jour ?'))return;
 setBusy(true);
 try{
  const deletedId=editing;
  const result=await api('/api/patchnotes',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'delete',id:deletedId,...(editingUpdatedAt?{expectedUpdatedAt:editingUpdatedAt}:{})})});
  if(result.deleted!==true)throw Error('La suppression n’a pas été confirmée.');
  // Leave the deleted detail immediately; the fresh index is authoritative.
  history.replaceState(null,'','/patchnotes');
  $('#patchnotesDetail').hidden=true;$('#patchnotesIndex').hidden=false;
  $('#patchnotesTitle').textContent='Journal des mises à jour.';
  $('#patchnotesSubtitle').textContent='Toutes les évolutions du client Rob Run, correctifs et nouvelles fonctionnalités, au même endroit.';
  document.title='Patchnotes · BRO CLIENT';
  fillEditor(null);
  all=all.filter(note=>note.id!==deletedId);loadList(all);
  showMessage('Mise à jour supprimée.','success');
  try{const data=await api('/api/patchnotes');isEditor=data.editor===true;admin.hidden=!isEditor;all=data.notes||[];loadList(all);}
  catch{showMessage('Mise à jour supprimée. Actualise la page pour recharger la liste.','success');}
 }catch(error){showMessage(error.message,'error');}
 finally{setBusy(false);}
});
$('#patchnotesReplay').addEventListener('click',async()=>{
 if(!isEditor)return;
 const btn=$('#patchnotesReplay'),status=$('#patchnotesReplayStatus');
 btn.disabled=true;status.textContent='Vérification des transactions confirmées…';
 try{
  const result=await api('/api/admin/notifications/replay-today',{
   method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
  });
  status.textContent='Notifications envoyées : '+(result.sent??0)
   +' · Déjà envoyées : '+(result.alreadySent??0)
   +' · Paiements sans Discord associé : '+(result.unlinked??0)
   +' · Échecs : '+(result.errors??0);
 }catch(error){status.textContent='Impossible de synchroniser : '+error.message;}
 finally{btn.disabled=false;}
});
refresh().catch(e=>{showMessage(e.message,'error');list.replaceChildren(create('p','Impossible de charger les mises à jour.','patchnotes-empty'));});
