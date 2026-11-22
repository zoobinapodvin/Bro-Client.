'use strict';
const $ = selector => document.querySelector(selector);
const modal = $('#modal');
const body = $('#modalBody');
const paths = {
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  cube:'<path d="m12 2 9 5v10l-9 5-9-5V7zm-9 5 9 5 9-5m-9 5v10"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  file:'<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8m-8 4h6"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
let site, user = null, accountReady = false;
const block = (tag, text, cls) => {
  const el = document.createElement(tag);
  if(text !== undefined) el.textContent = text;
  if(cls) el.className = cls;
  return el;
};
function link(text,href,cls) {
  const el=block('a',text,cls); el.href=href; return el;
}
function button(text,callback,cls='btn ghost'){
  const el=block('button',text,cls); el.type='button'; el.addEventListener('click',callback); return el;
}
function asset(value) {
  if(typeof value !== 'string' || !value.trim()) return '';
  try { const url=new URL(value,location.origin); return ['https:'].includes(url.protocol)||url.origin===location.origin ? url.href : ''; }
  catch { return ''; }
}
function render(){
  const c=site.content;
  document.querySelectorAll('[data-key]').forEach(el=>{if(c[el.dataset.key] !== undefined) el.textContent=c[el.dataset.key];});
  const logo=asset(c.brandLogo);
  document.querySelectorAll('.brand,.small-brand').forEach(el=>{
    if(logo){const img=new Image();img.alt=c.brand;img.src=logo;el.replaceChildren(img);}
    else {const mark=block('span',c.brand,'mark');el.replaceChildren(mark);}
  });
  if($('.art')) $('.art').style.backgroundImage=asset(c.heroImage) ? 'url('+JSON.stringify(asset(c.heroImage))+')' : 'none';
  $('#plans')?.replaceChildren(...site.plans.map(plan=>{
    const card=block('article',undefined,'plan '+plan.id);
    const row=block('div',undefined,'plan-top');
    row.setAttribute('aria-hidden','true');
    row.append(block('span','BRO.','pass-mark'),block('span',plan.duration,'pass-duration'));
    const price=block('div',undefined,'amount');
    price.append(block('strong',new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(plan.price)+' €'),block('small','paiement unique'));
    card.append(row,block('h3',plan.name),block('p',plan.description),price,button(c.planButton,()=>checkout(plan),'btn plan-button')); return card;
  }));
  $('#questions').replaceChildren(...[1,2,3].map(i=>{const el=block('details');el.append(block('summary',c['q'+i]),block('p',c['a'+i]));return el;}));
}
function openDialog(title) {
  modal.classList.remove('editing');body.replaceChildren();
  const heading=block('h2',title);heading.id='dialogTitle';body.append(heading);modal.setAttribute('aria-labelledby','dialogTitle');
  if(!modal.open)modal.showModal();modal.scrollTop=0;
}
function checkout(plan) {
  if(plan.checkoutUrl){location.assign('/checkout/'+plan.id);return;}
  openDialog(plan.name);
  body.append(block('p','Le paiement de cette offre est en attente de son lien Whop.'),block('p',plan.price+' € · '+plan.duration));
  body.append(button('Revenir aux offres',()=>modal.close()));
}
function account(){
  openDialog(site?.content.accountLabel||'Espace client');
  if(!accountReady){body.append(block('p','Impossible de récupérer ta session.'));body.append(button('Réessayer',async()=>{await loadUser();account();}));return;}
  if(!user){
    body.append(block('p','Connecte-toi pour consulter tes achats et retrouver tes factures.'));
    const area=block('div',undefined,'modal-actions');area.append(link('Se connecter','/auth/login?return_to=/%23compte','btn cyan'));body.append(area);return;
  }
  body.append(block('p',user.email,'account-email'));
  const invoices=block('section',undefined,'account-block');const results=block('div');
  const portal=link('Ouvrir mes achats sur Whop','https://whop.com/@me/settings/orders/');portal.target='_blank';portal.rel='noopener noreferrer';
  invoices.append(block('h3','Mes factures'),results,portal);body.append(invoices);
  loadInvoices(results);
  const section=block('section',undefined,'account-block');section.append(block('h3','Mes guides'),button('Consulter les guides',()=>guides(false)));body.append(section);
  const discord=block('section',undefined,'account-block');
  const help=block('p','Ton compte Discord est utilisé pour vérifier tes achats et ton rôle sur le serveur Bro Client.','notice');
  const feedback=block('p','','notice');feedback.setAttribute('role','status');
  discord.append(block('h3','Discord et rôle client'),help,feedback);
  const discordActions=block('div',undefined,'modal-actions');
  const sync=button('Synchroniser mon rôle Discord',async()=>{
    sync.disabled=true;feedback.textContent='Vérification de ton achat et de ton rôle…';
    try {
      const res=await fetch('/api/discord/sync',{method:'POST'});
      const result=await res.json();
      if(!res.ok)throw Error(result.error||'Erreur de synchronisation.');
      const labels={
        role_granted:'Rôle client activé sur ton compte Discord.',
        role_expired:'Ton pass est expiré ; le rôle a été retiré.',
        no_purchase:'Aucun achat vérifié associé à ton compte Discord. Les achats invités ne peuvent pas être reconnus automatiquement.',
        bot_unconfigured:'L’installation du bot Discord n’est pas encore terminée.',
        not_member:'Tu dois rejoindre le serveur Discord Bro Client avant de synchroniser ton rôle.',
        insufficient_permissions:'Le bot doit être placé au-dessus du rôle Client et disposer de la permission Gérer les rôles.',
        discord_unavailable:'Discord ne répond pas. Réessaie plus tard.',
        identity_missing:'Impossible de retrouver ton identifiant Discord. Reconnecte-toi.'
      };
      feedback.textContent=labels[result.status]||'Synchronisation indisponible.';
    }catch(error){feedback.textContent=error.message;}
    finally{sync.disabled=false;}
  },'btn cyan');
  discordActions.append(sync);
  const invite=link('Rejoindre le Discord','https://discord.gg/uRQyKBhhgA','btn ghost');invite.target='_blank';invite.rel='noopener noreferrer';
  discordActions.append(invite);
  if(user.admin){
    discordActions.append(button('Installer les commandes /bro',async()=>{
      feedback.textContent='Enregistrement des commandes…';
      try {
        const response=await fetch('/api/discord/register',{method:'POST'});
        const result=await response.json();
        feedback.textContent=result.status==='registered'?'Commandes Discord /bro installées.':'Complète d’abord la configuration du bot.';
      } catch {feedback.textContent='L’enregistrement des commandes a échoué.';}
    },'btn ghost'));
  }
  discord.append(discordActions);body.append(discord);
  const area=block('div',undefined,'modal-actions');
  if(user.admin)area.append(button('Administrer le site',editor,'btn cyan'),button('Gérer les guides',()=>guides(true)));
  area.append(link('Se déconnecter','/auth/logout','btn ghost'));body.append(area);
}
async function loadInvoices(target,cursor) {
  const note=block('p','Chargement des paiements…');target.append(note);
  try{
    const response=await fetch('/api/invoices'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    if(!response.ok)throw Error();
    const data=await response.json();note.remove();
    if(data.mode!=='synced'){target.append(block('p','Tes factures sont disponibles dans le portail Whop avec le compte utilisé pour ton achat.'));return;}
    if(!data.invoices?.length&&!cursor)target.append(block('p','Aucun paiement à afficher pour le moment.'));
    for(const invoice of data.invoices||[]){
      const row=block('div',undefined,'invoice');row.append(block('strong',invoice.title||'Paiement'));
      const date=new Date(invoice.date);
      const amount=new Intl.NumberFormat('fr-FR',{style:'currency',currency:invoice.currency||'EUR'}).format(invoice.amount);
      row.append(block('p',[Number.isNaN(date.valueOf())?'':date.toLocaleDateString('fr-FR'),amount].filter(Boolean).join(' · ')));
      if(asset(invoice.pdfUrl)){const pdf=link('Voir la facture',asset(invoice.pdfUrl));pdf.target='_blank';pdf.rel='noopener noreferrer';row.append(pdf);}target.append(row);
    }
    if(data.nextCursor){const more=button('Voir les paiements précédents',()=>{more.remove();loadInvoices(target,data.nextCursor);});target.append(more);}
  }catch{note.textContent='Le relevé est temporairement indisponible. Tes achats restent accessibles sur Whop.';}
}
const labels={
 legalIdentity:'Identité et statut juridique',legalAddress:'Adresse professionnelle',legalRegistration:'Immatriculation et TVA',legalDirector:'Responsable de publication',legalContact:'E-mail public',legalPhone:'Téléphone professionnel',legalMediator:'Nom, adresse et site du médiateur',brand:'Nom de marque',brandLogo:'Logo',heroImage:'Illustration de l’accueil',navHome:'Lien Accueil',navPlans:'Lien Tarifs',navFeatures:'Lien Fonctionnalités',navFaq:'Lien FAQ',accountLabel:'Espace client',
 eyebrow:'Étiquette',titleLine1:'Titre, première ligne',titleLine2:'Titre, deuxième ligne',intro:'Présentation',primary:'Bouton principal',secondary:'Bouton secondaire',
 pricingLabel:'Étiquette',pricingTitle:'Titre',pricingIntro:'Description',planButton:'Bouton de l’offre',lifetimeBadge:'Badge Lifetime',
 featureLabel:'Étiquette',featureTitle:'Titre',featureIntro:'Description',feature1Title:'Premier titre',feature1Text:'Premier texte',feature2Title:'Deuxième titre',feature2Text:'Deuxième texte',feature3Title:'Troisième titre',feature3Text:'Troisième texte',faqLabel:'Étiquette',faqTitle:'Titre',q1:'Question 1',a1:'Réponse 1',q2:'Question 2',a2:'Réponse 2',q3:'Question 3',a3:'Réponse 3',footer:'Texte du pied de page',name:'Nom',duration:'Durée',price:'Prix en euros',description:'Description',checkoutUrl:'Lien de paiement Whop'
};
async function guides(edit){
  openDialog(edit?'Gérer les guides':'Mes guides');
  const container=block('div'),status=block('p','Chargement…','notice');status.setAttribute('role','status');body.append(container,status,button('Retour au compte',account));
  try{
    const result=await fetch('/api/guides');if(!result.ok)throw Error();
    const {guides:items,revision}=await result.json();status.textContent='';
    function draw(){
      container.replaceChildren();
      if(!items.length)container.append(block('p','Aucun guide publié pour le moment.'));
      items.forEach((guide,i)=>{
        if(!edit){const details=block('details',undefined,'account-block');details.append(block('summary',guide.title),block('p',guide.body,'guide-body'));container.append(details);return;}
        const section=block('section',undefined,'editor account-block');
        for(const [key,label] of [['title','Titre'],['body','Contenu']]){
          const field=block('label',label),input=block(key==='body'?'textarea':'input');input.value=guide[key];input.oninput=()=>guide[key]=input.value;field.append(input);section.append(field);
        }
        section.append(button('Retirer ce guide',()=>{items.splice(i,1);draw();}));container.append(section);
      });
      if(edit){
        const save=button('Publier les modifications',async()=>{
          save.disabled=true;
          try{const res=await fetch('/api/guides',{method:'POST',headers:{'Content-Type':'application/json','If-Match':revision},body:JSON.stringify({guides:items})});
          if(!res.ok){status.textContent=res.status===409?'Une autre session a modifié les guides. Rouvre le catalogue.':'Vérifie les titres, les contenus et la taille du catalogue.';return;}await guides(true);body.append(block('p','Catalogue publié.','notice'));}catch{status.textContent='Enregistrement indisponible.';}finally{save.disabled=false;}
        },'btn cyan');
        container.append(button('Ajouter un guide',()=>{items.push({title:'',body:''});draw();container.querySelector('section:last-of-type input')?.focus();}),save);
      }
    }
    draw();
  }catch{status.textContent='Les guides sont momentanément indisponibles.';}
}
function editor(){
  if(!user?.admin)return;
  openDialog('Administration');modal.classList.add('editing');
  const draft=structuredClone({content:site.content,plans:site.plans});const revision=site.revision;
  const form=block('form',undefined,'editor');const status=block('p','','notice');status.setAttribute('role','status');
  let uploads=0;
  function group(title,record,keys){
    const section=block('details');section.append(block('summary',title));
    keys.forEach(key=>{
      const label=block('label',labels[key]||key);const multiline=/intro|Text|^a\d|description/i.test(key);
      const input=block(multiline?'textarea':'input');input.value=record[key]??'';
      if(key==='price'){input.type='number';input.min='0.01';input.step='0.01';}
      if(key==='checkoutUrl')input.type='url';
      input.addEventListener('input',()=>{record[key]=key==='price'?Number(input.value):input.value;});
      label.append(input);section.append(label);
      if(['brandLogo','heroImage'].includes(key)){
        const picker=block('label','Importer une image (PNG, JPEG ou WebP, 4 Mo maximum)');const file=block('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';picker.append(file);section.append(picker);
        file.onchange=async()=>{
          const image=file.files[0];if(!image)return;
          if(image.size>4*1024*1024){status.textContent='Cette image dépasse 4 Mo.';return;}
          uploads++;status.textContent='Importation en cours…';
          try{const res=await fetch('/api/media',{method:'POST',headers:{'Content-Type':image.type},body:image});if(!res.ok)throw Error();const data=await res.json();record[key]=input.value=data.url;status.textContent='Image prête à enregistrer.';}catch{status.textContent='L’importation a échoué.';}finally{uploads--;}
        };
      }
    });form.append(section);
  }
  group('Identité et navigation',draft.content,['brand','brandLogo','navHome','navPlans','navFeatures','navFaq','accountLabel','footer']);
  group('Informations légales',draft.content,['legalIdentity','legalAddress','legalRegistration','legalDirector','legalContact','legalPhone','legalMediator']);
  group('Accueil',draft.content,['heroImage','eyebrow','titleLine1','titleLine2','intro','primary','secondary']);
  group('Boutique',draft.content,['pricingLabel','pricingTitle','pricingIntro','planButton','lifetimeBadge']);
  draft.plans.forEach(plan=>group(plan.name,plan,['name','duration','price','description','checkoutUrl']));
  group('Fonctionnalités',draft.content,['featureLabel','featureTitle','featureIntro','feature1Title','feature1Text','feature2Title','feature2Text','feature3Title','feature3Text']);
  group('Questions fréquentes',draft.content,['faqLabel','faqTitle','q1','a1','q2','a2','q3','a3']);
  const actions=block('div',undefined,'modal-actions');const save=block('button','Enregistrer','btn cyan');save.type='submit';actions.append(save,button('Retour au compte',account));form.append(actions,status);body.append(form);
  form.onsubmit=async event=>{
    event.preventDefault();if(uploads){status.textContent='Attends la fin de l’importation.';return;}save.disabled=true;
    try{
      const res=await fetch('/api/site',{method:'POST',headers:{'Content-Type':'application/json','If-Match':revision||''},body:JSON.stringify(draft)});
      if(!res.ok){if(res.status===409||res.status===412){status.textContent='Le contenu a été modifié dans une autre session. Recharge la page avant de réessayer.';return;}throw Error();}
      const result=await res.json();site=result.content?result:await (await fetch('/api/site',{cache:'no-store'})).json();render();account();body.append(block('p','Modifications enregistrées.','notice'));
    }catch{status.textContent='Enregistrement impossible. Vérifie les champs et les liens Whop.';}finally{save.disabled=false;}
  };
}
async function loadUser(){try{const response=await fetch('/api/me',{cache:'no-store'});if(!response.ok)throw Error();user=(await response.json()).user;accountReady=true;}catch{accountReady=false;}}
document.querySelectorAll('i[data-icon]').forEach(el=>{el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+paths[el.dataset.icon]+'</svg>';});
$('.close').onclick=()=>modal.close();modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
document.querySelectorAll('[data-account]').forEach(el=>el.onclick=account);
const menu=$('nav');const hamburger=$('.hamb');hamburger.onclick=()=>{const show=menu.classList.toggle('open');hamburger.setAttribute('aria-expanded',String(show));};
menu.querySelectorAll('a').forEach(el=>el.onclick=()=>{menu.classList.remove('open');hamburger.setAttribute('aria-expanded','false');});
const sections=Array.from(menu.querySelectorAll('a[href^="#"]')).map(a=>[a,document.getElementById(a.hash.slice(1))]).filter(([,section])=>section);
function updateNav(){if(!sections.length)return;let current=sections[0];for(const pair of sections)if(pair[1].getBoundingClientRect().top<=180)current=pair;for(const [a] of sections)if(a===current[0])a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}
window.addEventListener('scroll',updateNav,{passive:true});
if(location.hash==='#tarifs')location.replace('/offres');
const gallery=$('.gallery-strip');
if(gallery){
 const slides=[['launcher','Le launcher'],['visuals','Affichage en jeu'],['settings','Interface de réglages'],['appearance','Options du joueur']];
 for(const [file,label] of slides){
   const src='/assets/full-'+file+'.webp';
   const select=button(label,()=>{
     $('#preview').src=src;$('#preview').alt=label+' — capture de Bro Client';$('#caption').textContent=label;$('#full-preview').href=src;$('#zoom').href=src;
     for(const item of gallery.children)item.setAttribute('aria-pressed',String(item===select));
   },'preview-tab');
   select.setAttribute('aria-pressed',String(file==='launcher'));gallery.append(select);
 }
}
(async()=>{
  const session=loadUser();
  try{const res=await fetch('/api/site',{cache:'no-store'});if(!res.ok)throw Error();site=await res.json();if(!site.content||!site.plans)throw Error();}
  catch{site=await(await fetch('/defaults.json')).json();}
  render();await session;if(location.hash==='#compte')account();
})();
